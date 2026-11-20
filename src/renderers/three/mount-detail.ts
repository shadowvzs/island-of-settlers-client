import { setArmourLod } from "@workers/game-three-armour";
import { type BufferGeometry, type Camera, type Object3D, SkinnedMesh, Vector3 } from "three";

/**
 * Distance detail of a High mounted soldier. Close up it shows the full horse and rider bodies
 * and armour LOD 0 (about 22-37k triangles); once a map cell spans fewer than
 * NEAR_PIXELS_PER_CELL screen pixels at the mount (normal gameplay zoom and further out) it swaps
 * to the Minimal horse and rider geometry and armour LOD 1 (about 6-7k). The Minimal meshes are
 * simplified from the High ones with the same skeleton, texture and UVs, so the swap only changes
 * the drawn geometry: the materials, skeleton and draw calls stay the same.
 */
export const NEAR_PIXELS_PER_CELL = 100;
/** Share around the threshold that must be crossed before switching back (no flicker). */
const HYSTERESIS = .08;

export interface GeometrySwap { far: BufferGeometry; mesh: SkinnedMesh; near: BufferGeometry }

/** Skinned body meshes of a model (armour excluded) in traversal order. */
export const listBodyMeshes = (root: Object3D) => {
  const meshes: SkinnedMesh[] = [];
  root.traverse(object => {
    if (object instanceof SkinnedMesh && !object.name.startsWith("armour_")) meshes.push(object);
  });
  return meshes;
};

/**
 * Pairs every body mesh of `near` with the same mesh of the simplified model `far` (same
 * structure); no pairs when the two models do not match.
 */
export const pairFarGeometry = (near: Object3D, far: Object3D): GeometrySwap[] => {
  const nearMeshes = listBodyMeshes(near), farMeshes = listBodyMeshes(far);
  if (nearMeshes.length !== farMeshes.length) return [];
  return nearMeshes.map((mesh, index) => ({ far: farMeshes[index]!.geometry, mesh, near: mesh.geometry }));
};

const across = new Vector3(), centre = new Vector3(), side = new Vector3();

/** Screen pixels that one world unit (a map cell) spans at `position`, for any camera. */
export const pixelsPerUnit = (camera: Camera, position: Vector3, viewportWidth: number) => {
  across.setFromMatrixColumn(camera.matrixWorld, 0);
  centre.copy(position).project(camera);
  side.copy(position).add(across).project(camera);
  return Math.abs(side.x - centre.x) * viewportWidth / 2;
};

/** Switches one mount (its root holds horse, rider and armour) between near and far detail. */
export const createMountDetail = (root: Object3D, swaps: readonly GeometrySwap[]) => {
  let near = true;
  const show = (value: boolean) => {
    if (value === near) return;
    near = value;
    for (const swap of swaps) swap.mesh.geometry = near ? swap.near : swap.far;
    setArmourLod(root, near ? 0 : 1);
  };
  return {
    isNear: () => near,
    /**
     * Sun shadow pass (R02/C07): a near mount casts with its simplified far geometry (the cheap
     * proxy); `false` restores the drawn geometry right after the pass.
     */
    useCasterGeometry: (on: boolean) => {
      if (!near) return;
      for (const swap of swaps) swap.mesh.geometry = on ? swap.far : swap.near;
    },
    /** `pixels`: screen pixels per map cell at the mount this frame. */
    update: (pixels: number) =>
      show(pixels >= NEAR_PIXELS_PER_CELL * (near ? 1 - HYSTERESIS : 1 + HYSTERESIS))
  };
};
