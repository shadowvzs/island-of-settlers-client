import {
  type Camera,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type MeshStandardMaterial,
  type Object3D,
  Scene,
  type WebGLRenderer
} from "three";

import { type BuildingFrame, getBuildingDefinition } from "../../../render-common/buildings/building-catalog";
import { isBuildingDetailed } from "../../../render-common/buildings/building-detail";
import type { BuildingSurface } from "../../../render-common/buildings/building-recipe";
import type { EnvironmentState } from "../../../render-common/environment";
import type { PlacementGhostFrame } from "../../../render-common/renderer-contract";
import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { createCrowdLights } from "../three-worker";
import { shareBuildingMaterialOwnership } from "./building-material-ownership";
import { createBuildingRoadMarkers } from "./building-road-marker";
import { buildingAssetReady } from "./monument-building";
import { createNationBuilding } from "./nation-building";
import { createPlacementRoadDashes } from "./placement-road-dashes";

type Model = ReturnType<typeof createNationBuilding>;
type MaterialsFor = (nation: WorkerNation) => Record<BuildingSurface, MeshStandardMaterial>;
type HeightAt = (x: number, z: number) => number;

/** Tint (and its self-lit share, so the ghost reads at night) of a refused plot. */
const REFUSED_TINT = { colour: 0xff6450, glow: 0x3a0c08, opacity: 0.62 } as const;
/** Owner 2026-11-02: retain the hovered valid preview at 85% opacity. */
const REAL_OPACITY = 0.85;
/** Recently shown ghost models kept for re-selection and LOD switches (one model each). */
const MODEL_CACHE_SIZE = 4;

/** Particles, lines and sprites cannot take the ghost mesh material: the ghost shows solids only. */
const hideNonMeshes = (root: Object3D) =>
  root.traverse((object) => {
    if ("isPoints" in object || "isLine" in object || "isSprite" in object) object.visible = false;
  });

const translucentCopy = (material: Material) => {
  const copy = material.clone();
  copy.transparent = true;
  copy.opacity = material.opacity * REAL_OPACITY;
  return copy;
};

/**
 * Gives every mesh a translucent copy of its material: shared surface materials map to one copy
 * each (kept in `shared`), a model's own materials are replaced by their copy (the model's
 * dispose frees it). The real buildings' materials stay untouched.
 */
const useTranslucentMaterials = (root: Object3D, shared: Map<Material, Material>) =>
  root.traverse((object) => {
    if (!(object instanceof Mesh) || Array.isArray(object.material)) return;
    const material = object.material as Material;
    if (object.userData.ownedMaterial) {
      object.material = translucentCopy(material);
      shareBuildingMaterialOwnership(material, object.material);
      material.dispose();
      return;
    }
    let copy = shared.get(material);
    if (!copy) { copy = translucentCopy(material); shared.set(material, copy); }
    object.material = copy;
  });

/** The cursor ghost's signpost (as on a finished building), built once and only moved. */
const createGhostSignpost = (scene: Scene, getHeight: HeightAt) => {
  const markers = createBuildingRoadMarkers();
  const marker = markers.create();
  const ground = { sample: getHeight };
  const frame: BuildingFrame = { construction: 1, door: 0, id: "placement-ghost", nation: "roman", rotation: 0,
    type: -1, working: false, x: 0, y: 0, z: 0 };
  marker.visible = false;
  scene.add(marker);
  const place = (ghost: PlacementGhostFrame) => {
    Object.assign(frame, { nation: ghost.nation, rotation: ghost.rotation, type: ghost.type, x: ghost.x,
      y: ghost.y, z: ghost.z });
    markers.update(marker, frame, ground);
    marker.visible = true;
  };
  const hide = () => { marker.visible = false; };
  return { dispose: markers.dispose, hide, place };
};

/**
 * The building the player is placing. On a valid plot it is drawn almost
 * like the real building: the detailed nation model with translucent copies of its own
 * materials, its signpost and its planned road as dashes. On a refused plot it is a red ghost
 * through one tint material (the usual level of detail). Both draw depth first, then colour, so
 * only the outer surface shows. Models are built once per building, nation and level of detail
 * and kept in a small cache; the ghost is moved only when its frame changes (a new plot), so a
 * frame allocates nothing.
 */
export const createBuildingPlacementGhost = (high: boolean, materialsFor: MaterialsFor, getHeight: HeightAt) => {
  const scene = new Scene();
  const updateLights = createCrowdLights(scene);
  const depthMaterial = new MeshBasicMaterial({ colorWrite: false });
  const refusedMaterial = new MeshLambertMaterial({ color: REFUSED_TINT.colour, depthWrite: false,
    emissive: REFUSED_TINT.glow, opacity: REFUSED_TINT.opacity, transparent: true });
  const sharedCopies = new Map<Material, Material>();
  const signpost = createGhostSignpost(scene, getHeight);
  const roadDashes = createPlacementRoadDashes(scene, getHeight);
  const models = new Map<string, Model>();
  let placed: PlacementGhostFrame | null = null, real = false, shown: Model | null = null;
  /** What the shown model is, compared field by field (no key string per frame). */
  const shownAs = { detailed: false, nation: "roman" as WorkerNation, type: -1 };

  const evictOldest = () => {
    if (models.size <= MODEL_CACHE_SIZE) return;
    const [key, model] = models.entries().next().value!;
    models.delete(key);
    model.dispose();
  };

  /** Cached (most recently used last) or newly built model of a building, nation and LOD. */
  const modelFor = (type: number, nation: WorkerNation, detailed: boolean) => {
    const key = `${nation}/${type}/${Number(detailed)}`;
    let model = models.get(key);
    if (model) models.delete(key);
    else {
      model = createNationBuilding(getBuildingDefinition(type), materialsFor(nation), nation, detailed);
      model.fitToGrid();
      hideNonMeshes(model.root);
      useTranslucentMaterials(model.root, sharedCopies);
      if (type === 7) {
        const pending = model;
        void buildingAssetReady(pending.root).then(() => {
          if (pending.root.userData.disposed) return;
          hideNonMeshes(pending.root); useTranslucentMaterials(pending.root, sharedCopies);
        }).catch(error => { if (!pending.root.userData.disposed) console.error("Monument preview could not load", error); });
      }
    }
    models.set(key, model);
    evictOldest();
    return model;
  };

  const show = (model: Model | null) => {
    if (model === shown) return;
    if (shown) scene.remove(shown.root);
    if (model) scene.add(model.root);
    shown = model;
  };

  const showModel = (ghost: PlacementGhostFrame, detailed: boolean) => {
    const same = shownAs.type === ghost.type && shownAs.nation === ghost.nation && shownAs.detailed === detailed;
    if (shown && same) return shown;
    Object.assign(shownAs, { detailed, nation: ghost.nation, type: ghost.type });
    const model = modelFor(ghost.type, ghost.nation, detailed);
    show(model);
    return model;
  };

  /** Moves the ghost, its signpost and road to a new frame (a new plot or verdict). */
  const place = (ghost: PlacementGhostFrame) => {
    placed = ghost;
    real = ghost.valid;
    if (real) signpost.place(ghost);
    else signpost.hide();
    roadDashes.update(real ? ghost.road : null);
  };

  const hide = () => {
    show(null);
    signpost.hide();
    roadDashes.update(null);
    placed = null;
  };

  const update = (ghost: PlacementGhostFrame | null | undefined, zoom: number, environment: EnvironmentState) => {
    if (!ghost) { if (placed) hide(); return; }
    // The hovered valid plot always shows the detailed recipe: the zoomed-out one reads boxy.
    const model = showModel(ghost, ghost.valid || isBuildingDetailed(high, zoom));
    model.root.position.set(ghost.x, ghost.y, ghost.z);
    model.root.rotation.y = ghost.rotation;
    if (ghost !== placed) place(ghost);
    updateLights(environment);
  };

  const render = (renderer: WebGLRenderer, camera: Camera) => {
    if (!shown) return;
    scene.overrideMaterial = depthMaterial;
    renderer.render(scene, camera);
    scene.overrideMaterial = real ? null : refusedMaterial;
    renderer.render(scene, camera);
  };

  const dispose = () => {
    show(null);
    for (const model of models.values()) model.dispose();
    models.clear();
    for (const copy of sharedCopies.values()) copy.dispose();
    sharedCopies.clear();
    signpost.dispose();
    roadDashes.dispose();
    depthMaterial.dispose();
    refusedMaterial.dispose();
    scene.clear();
  };

  return { dispose, render, update };
};
