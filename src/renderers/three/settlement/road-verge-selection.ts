import { Box3, type Camera, Frustum, Matrix4, type PerspectiveCamera, Vector3 } from "three";

import { type RoadVergeChunks, vergeKeptCount } from "../../../render-common/road-verges/road-verge-chunks";
import { roadVergeKeepLevel, roadVergeNear, VERGE_KEEP_LEVELS, VERGE_REFERENCE_HEIGHT, type VergeKeepLevel,
  vergeProjectedPixels } from "../../../render-common/road-verges/road-verge-density";
import { VERGE_SPECIES } from "../../../render-common/road-verges/verge-plant-geometry";

export interface RoadVergeBudget { far: number; near: number }

/** Tier a chunk is drawn with: 0 hidden, 1 Minimal whole-plant cards, 2 authored High parts. */
export type VergeTier = 0 | 1 | 2;

/**
 * Per-chunk visibility, kept subset and tier from the camera, by projected size (O5). All state
 * is preallocated per verge rebuild; a frame without a meaningful camera change does no work.
 */
export const createRoadVergeSelection = (data: RoadVergeChunks, budget: RoadVergeBudget, detailed: boolean) => {
  const count = data.chunks.length;
  const pixels = new Float32Array(count), levels = new Uint8Array(count), tiers = new Uint8Array(count);
  const kept = new Int32Array(count), order = Int32Array.from({ length: count }, (_, index) => index);
  const frustum = new Frustum(), matrix = new Matrix4(), box = new Box3(), eye = new Vector3();
  const last = new Float32Array(9), next = new Float32Array(9);
  let stale = true;
  /** Desired keep level before the budget (with hysteresis on the drawn level). */
  const desired = new Uint8Array(count);

  /** Quantised camera change: 0.2 units of travel, a small turn, 1% zoom or a resize. */
  const cameraMoved = (camera: Camera, viewportHeight: number) => {
    const { position, quaternion } = camera;
    next[0] = position.x; next[1] = position.y; next[2] = position.z;
    next[3] = quaternion.x; next[4] = quaternion.y; next[5] = quaternion.z; next[6] = quaternion.w;
    next[7] = camera.projectionMatrix.elements[5]!; next[8] = viewportHeight;
    const travel = Math.hypot(next[0] - last[0]!, next[1] - last[1]!, next[2] - last[2]!);
    const turn = Math.abs(next[3] - last[3]!) + Math.abs(next[4] - last[4]!) + Math.abs(next[5] - last[5]!) +
      Math.abs(next[6] - last[6]!);
    const zoom = Math.abs(next[7] / (last[7] || 1) - 1);
    if (!stale && travel <= .2 && turn <= .003 && zoom <= .01 && next[8] === last[8]) return false;
    last.set(next); stale = false;
    return true;
  };

  const keptPlants = (chunk: number, level: number) => {
    let plants = 0;
    for (let kind = 0; kind < VERGE_SPECIES.length; kind += 1)
      plants += vergeKeptCount(data, data.chunks[chunk]!, kind, VERGE_KEEP_LEVELS[level]!);
    return plants;
  };

  const measure = (camera: Camera, viewportHeight: number) => {
    camera.updateMatrixWorld();
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(matrix);
    eye.setFromMatrixPosition(camera.matrixWorld);
    const orthographic = (camera as { isOrthographicCamera?: boolean }).isOrthographicCamera === true;
    const scale = Math.abs(camera.projectionMatrix.elements[5]!);
    for (let index = 0; index < count; index += 1) {
      const chunk = data.chunks[index]!;
      box.min.set(chunk.minX, chunk.minY, chunk.minZ); box.max.set(chunk.maxX, chunk.maxY, chunk.maxZ);
      const inView = frustum.intersectsBox(box);
      pixels[index] = inView
        ? vergeProjectedPixels(VERGE_REFERENCE_HEIGHT, box.distanceToPoint(eye), scale, viewportHeight, orthographic)
        : 0;
      desired[index] = inView ? roadVergeKeepLevel(pixels[index]!, levels[index] as VergeKeepLevel) : 0;
    }
  };

  /** Nearest chunks first; the near and far budgets thin the farthest chunks before the closest. */
  const allocate = () => {
    order.sort((first, second) => pixels[second]! - pixels[first]!);
    let nearLeft = detailed ? budget.near : 0, farLeft = budget.far, changed = false;
    for (let slot = 0; slot < count; slot += 1) {
      const index = order[slot]!;
      let level = desired[index]!, tier: VergeTier = 0, plants = 0;
      if (level > 0 && detailed && roadVergeNear(pixels[index]!, tiers[index] === 2)) {
        plants = keptPlants(index, level);
        if (plants <= nearLeft) { tier = 2; nearLeft -= plants; }
      }
      while (tier === 0 && level > 0) {
        plants = keptPlants(index, level);
        if (plants <= farLeft) { tier = 1; farLeft -= plants; } else level -= 1;
      }
      if (tier === 0) level = 0;
      if (levels[index] !== level || tiers[index] !== tier) changed = true;
      levels[index] = level; tiers[index] = tier; kept[index] = tier ? plants : 0;
    }
    return changed;
  };

  /** True when the drawn subset changed and the instance buffers must be refilled. */
  const update = (camera: Camera | PerspectiveCamera, viewportHeight: number) => {
    if (count === 0 || !cameraMoved(camera, viewportHeight)) return false;
    measure(camera, viewportHeight);
    return allocate();
  };

  /** Forces the next update to re-measure (new meshes, a changed budget). */
  const invalidate = () => { stale = true; };

  return { invalidate, kept, levels, tiers, update };
};
