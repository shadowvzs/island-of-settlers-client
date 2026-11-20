import { type Camera, InstancedMesh, LOD, Matrix4, Object3D, OrthographicCamera, Vector3 } from "three";

import type { OrnamentalBlossom } from "../../../render-common/plants/ornamental-tree-graph";
import { createPeachBlossomInstances } from "./peach-blossom-instances";
import type { PeachBlossomTreeTemplates } from "./peach-blossom-tree-templates";

/** True3D flowers at every tier; projected size promotes only the largest visible close blossoms. */
export const createPeachBlossomTreeLod = (flowers: readonly OrnamentalBlossom[],
  templates: PeachBlossomTreeTemplates, detailed: boolean) => {
  const root = new LOD(); root.name = "peach-flower-projected-lod";
  const heroLimit = detailed ? 128 : 48;
  const hero = createPeachBlossomInstances(flowers.slice(0, heroLimit), templates.hero, templates.materials, detailed);
  const canopy = createPeachBlossomInstances(flowers, templates.canopy, templates.materials, detailed);
  const far = createPeachBlossomInstances(flowers, templates.far, templates.materials, detailed);
  const heroMeshes = hero.root.children as InstancedMesh[], canopyMeshes = canopy.root.children as InstancedMesh[];
  const farMeshes = far.root.children as InstancedMesh[];
  root.add(hero.root, canopy.root, far.root);
  [...heroMeshes, ...canopyMeshes].forEach(mesh => { mesh.count = 0; });
  const transform = new Object3D();
  const matrices = flowers.map(flower => {
    transform.position.set(...flower.position); transform.rotation.set(flower.pitch, flower.yaw, 0, "YXZ");
    transform.scale.setScalar(flower.radius); transform.updateMatrix(); return transform.matrix.clone();
  });
  const worldPosition = new Vector3(), centre = new Vector3(), worldScale = new Vector3();
  const lastCamera = new Matrix4(), lastProjection = new Matrix4(), lastRoot = new Matrix4();
  const maxRadius = Math.max(0, ...flowers.map(flower => flower.radius));
  const reach = Math.max(0, ...flowers.map(flower => new Vector3(...flower.position).length() + flower.radius));
  const heroThreshold = detailed ? .24 : .30, canopyThreshold = detailed ? .045 : .065;
  const active = new Uint8Array(flowers.length);
  let heroCount = 0, canopyCount = 0, initialized = false;
  const refresh = (meshes: InstancedMesh[], count: number) => meshes.forEach(mesh => {
    mesh.count = count; mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
  });
  root.update = (camera: Camera) => {
    if (initialized && lastCamera.equals(camera.matrixWorld) && lastProjection.equals(camera.projectionMatrix) &&
      lastRoot.equals(root.matrixWorld)) return;
    initialized = true; lastCamera.copy(camera.matrixWorld); lastProjection.copy(camera.projectionMatrix);
    lastRoot.copy(root.matrixWorld);
    const projection = Math.abs(camera.projectionMatrix.elements[5]!);
    centre.setFromMatrixPosition(root.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
    worldScale.setFromMatrixScale(root.matrixWorld);
    const scale = Math.max(Math.abs(worldScale.x), Math.abs(worldScale.y), Math.abs(worldScale.z));
    const orthographic = camera instanceof OrthographicCamera;
    const maxCanopyDistance = 2 * maxRadius * scale * projection / canopyThreshold;
    const distant = !orthographic && -centre.z > reach * scale + maxCanopyDistance;
    if (distant && heroCount === 0 && canopyCount === 0) return;
    active.fill(0);
    const candidates: Array<{ index: number; diameter: number }> = [];
    if (!distant) flowers.forEach((flower, index) => {
      worldPosition.set(...flower.position).applyMatrix4(root.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      let diameter = 0;
      if (orthographic) diameter = 2 * flower.radius * scale * projection;
      else if (worldPosition.z < 0) diameter = 2 * flower.radius * scale * projection / -worldPosition.z;
      worldPosition.applyMatrix4(camera.projectionMatrix);
      const inFrame = Math.abs(worldPosition.x) <= 1 + diameter * .6 &&
        Math.abs(worldPosition.y) <= 1 + diameter * .6 && Math.abs(worldPosition.z) <= 1 + diameter;
      if (!inFrame) return;
      if (diameter > canopyThreshold) active[index] = 1;
      if (diameter > heroThreshold) candidates.push({ index, diameter });
    });
    candidates.sort((first, second) => second.diameter - first.diameter || first.index - second.index);
    for (let index = 0; index < Math.min(heroLimit, candidates.length); index++) active[candidates[index]!.index] = 2;
    let nextHero = 0, nextCanopy = 0, nextFar = 0;
    flowers.forEach((_, index) => {
      let meshes = farMeshes, target = nextFar++;
      if (active[index] === 2) { meshes = heroMeshes; target = nextHero++; nextFar--; }
      else if (active[index] === 1) { meshes = canopyMeshes; target = nextCanopy++; nextFar--; }
      meshes.forEach(mesh => mesh.setMatrixAt(target, matrices[index]!));
    });
    heroCount = nextHero; canopyCount = nextCanopy;
    refresh(heroMeshes, nextHero); refresh(canopyMeshes, nextCanopy); refresh(farMeshes, nextFar);
  };
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; hero.dispose(); canopy.dispose(); far.dispose(); root.clear(); root.removeFromParent();
  };
  const snapshot = () => {
    const farCount = flowers.length - heroCount - canopyCount;
    return { hero: heroCount, canopy: canopyCount, far: farCount, heroLimit,
      triangles: heroCount * templates.heroCost + canopyCount * templates.canopyCost + farCount * templates.farCost };
  };
  return { root, snapshot, farTriangles: flowers.length * templates.farCost, dispose };
};
