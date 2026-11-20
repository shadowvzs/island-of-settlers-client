import {
  type BufferGeometry,
  type Camera,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Scene,
  SkinnedMesh,
  Vector3,
  type WebGLRenderer
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { getBuildingDefinition } from "../../../render-common/buildings/building-catalog";
import type { BuildingSurface } from "../../../render-common/buildings/building-recipe";
import type { EnvironmentState } from "../../../render-common/environment";
import type { PlacementPreviewFrame } from "../../../render-common/renderer-contract";
import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { createCrowdLights } from "../three-worker";
import { buildingAssetReady } from "./monument-building";
import { createNationBuilding } from "./nation-building";

type MaterialsFor = (nation: WorkerNation) => Record<BuildingSurface, MeshStandardMaterial>;

/** Near white (reads on grass, sand and snow), faint beside the near-real hovered plot (0.85). */
const PREVIEW_TINT = { colour: 0xf4fbef, glow: 0x101810, opacity: 0.22 } as const;
/** Merged preview models kept for re-selection (one geometry per building and nation). */
const GEOMETRY_CACHE_SIZE = 4;

/** Position and normal of every visible solid mesh of a model, in its grid-fitted local space. */
const mergeSolidGeometry = (root: Object3D) => {
  root.updateMatrixWorld(true);
  const pieces: BufferGeometry[] = [];
  root.traverseVisible((object) => {
    if (!(object instanceof Mesh) || object instanceof SkinnedMesh || object instanceof InstancedMesh) return;
    const piece = object.geometry.clone() as BufferGeometry;
    piece.morphAttributes = {};
    for (const name of Object.keys(piece.attributes))
      if (name !== "position" && name !== "normal") piece.deleteAttribute(name);
    if (!piece.getAttribute("normal")) piece.computeVertexNormals();
    piece.applyMatrix4(object.matrixWorld);
    pieces.push(piece.index ? piece.toNonIndexed() : piece);
    if (piece.index) piece.dispose();
  });
  const merged = pieces.length ? mergeGeometries(pieces) : null;
  for (const piece of pieces) piece.dispose();
  return merged;
};

/**
 * The faint preview ghosts of the building being placed, on the valid plots the app chose: the
 * zoomed-out (Minimal) recipe on every detail level, merged once per building and nation into
 * one geometry and drawn as one instanced mesh through one ghost material, depth first, then
 * colour, so only the outer surface shows and buildings in front hide them. Never shadowed nor
 * picked (own scene). Instances are rewritten only when the frame's revision changes.
 */
export const createBuildingPlacementPreviews = (materialsFor: MaterialsFor) => {
  const scene = new Scene();
  const updateLights = createCrowdLights(scene);
  const depthMaterial = new MeshBasicMaterial({ colorWrite: false });
  const material = new MeshLambertMaterial({ color: PREVIEW_TINT.colour, depthWrite: false,
    emissive: PREVIEW_TINT.glow, opacity: PREVIEW_TINT.opacity, transparent: true });
  const geometries = new Map<string, BufferGeometry | null>();
  const pending = new Map<string, ReturnType<typeof createNationBuilding>>();
  let disposed = false;
  const matrix = new Matrix4(), position = new Vector3(), turn = new Quaternion(), scale = new Vector3(1, 1, 1);
  const up = new Vector3(0, 1, 0);
  let mesh: InstancedMesh | null = null, uploaded = -1;

  /** Cached (most recently used last) or newly merged geometry of a building and nation. */
  const geometryFor = (type: number, nation: WorkerNation) => {
    const key = `${nation}/${type}`;
    if (geometries.has(key)) {
      const cached = geometries.get(key)!;
      geometries.delete(key);
      geometries.set(key, cached);
      return cached;
    }
    const model = createNationBuilding(getBuildingDefinition(type), materialsFor(nation), nation, false);
    model.fitToGrid();
    if (type === 7) {
      geometries.set(key, null); pending.set(key, model);
      void buildingAssetReady(model.root).then(() => {
        if (disposed || pending.get(key) !== model) return;
        pending.delete(key); geometries.set(key, mergeSolidGeometry(model.root));
        model.dispose(); uploaded = -1;
        if (geometries.size > GEOMETRY_CACHE_SIZE) evictOldest();
      }).catch(error => {
        if (!disposed && pending.get(key) === model) {
          pending.delete(key); geometries.delete(key); model.dispose();
          console.error("Monument placement previews could not load", error);
        }
      });
      if (geometries.size > GEOMETRY_CACHE_SIZE) evictOldest();
      return null;
    }
    const merged = mergeSolidGeometry(model.root);
    model.dispose();
    geometries.set(key, merged);
    if (geometries.size > GEOMETRY_CACHE_SIZE) evictOldest();
    return merged;
  };

  const evictOldest = () => {
    const [key, geometry] = geometries.entries().next().value!;
    geometries.delete(key);
    pending.get(key)?.dispose(); pending.delete(key);
    geometry?.dispose();
  };

  /** The instanced mesh with room for `capacity` previews and this geometry. */
  const meshFor = (geometry: BufferGeometry, capacity: number) => {
    if (mesh && mesh.instanceMatrix.count >= capacity) {
      mesh.geometry = geometry;
      return mesh;
    }
    if (mesh) { scene.remove(mesh); mesh.dispose(); }
    mesh = new InstancedMesh(geometry, material, capacity);
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  };

  const upload = (frame: PlacementPreviewFrame) => {
    uploaded = frame.revision;
    const geometry = geometryFor(frame.type, frame.nation);
    if (!geometry) { if (mesh) mesh.visible = false; return; }
    const target = meshFor(geometry, frame.positions.length / 3);
    turn.setFromAxisAngle(up, frame.rotation);
    for (let index = 0; index < frame.count; index++) {
      position.fromArray(frame.positions, index * 3);
      target.setMatrixAt(index, matrix.compose(position, turn, scale));
    }
    target.count = frame.count;
    target.instanceMatrix.needsUpdate = true;
    target.visible = frame.count > 0;
  };

  const update = (frame: PlacementPreviewFrame | null | undefined, environment: EnvironmentState) => {
    if (!frame) { if (mesh) mesh.visible = false; return; }
    if (frame.revision !== uploaded || !mesh?.visible) upload(frame);
    updateLights(environment);
  };

  const render = (renderer: WebGLRenderer, camera: Camera) => {
    if (!mesh?.visible) return;
    scene.overrideMaterial = depthMaterial;
    renderer.render(scene, camera);
    scene.overrideMaterial = null;
    renderer.render(scene, camera);
  };

  const dispose = () => {
    disposed = true; pending.forEach(model => model.dispose()); pending.clear();
    mesh?.dispose();
    for (const geometry of geometries.values()) geometry?.dispose();
    geometries.clear();
    depthMaterial.dispose();
    material.dispose();
    scene.clear();
  };

  /** Triangles the previews draw this frame. */
  const getStats = () => {
    if (!mesh?.visible) return { placementPreviewTriangles: 0 };
    return { placementPreviewTriangles: mesh.count * mesh.geometry.getAttribute("position").count / 3 };
  };

  return { dispose, getStats, render, update };
};
