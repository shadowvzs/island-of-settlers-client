import { type Matrix4, Vector3 } from "three";

import type { OrnamentalPlantTier } from "../../../../../island-of-settlers-shared/src/road-plant-models";
import type { RoadDecorationFrame } from "../../../shared/settlement/road-decoration-state";
import { ornamentalDecorationProfile } from "./ornamental-decoration-profile";

export interface PlantLodCamera {
  position: { x: number; y: number; z: number };
  quaternion?: { x: number; y: number; z: number; w: number };
  projectionMatrix?: Matrix4;
  matrixWorldInverse?: Matrix4;
  isOrthographicCamera?: boolean;
  updateMatrixWorld?(): void;
}

/** Camera decisions are quantized; no frame-loop geometry generation, imports, matrices or sorting. */
export const createOrnamentalPlantLod = (detailed: boolean) => {
  let cameraKey = "", previous: readonly RoadDecorationFrame[] | undefined;
  let tiers = new Map<number, OrnamentalPlantTier>();
  const point = new Vector3();
  const update = (frames: readonly RoadDecorationFrame[], camera?: PlantLodCamera, viewportHeight = 900) => {
    if (!camera) return false;
    const { x, y, z } = camera.position;
    const projectionScale = Math.abs(camera.projectionMatrix?.elements[5] ?? 1);
    const zoomStep = Math.round(Math.log2(projectionScale * viewportHeight) * 8);
    const orientation = camera.quaternion;
    const facing = orientation ? [orientation.x, orientation.y, orientation.z, orientation.w]
      .map(value => Math.round(value * 16)).join(":") : "";
    const widthStep = Math.round((camera.projectionMatrix?.elements[0] ?? 1) * 100);
    const key = `${Math.floor(x / 2)}:${Math.floor(y / 2)}:${Math.floor(z / 2)}:${zoomStep}:${widthStep}:${facing}`;
    if (key === cameraKey && previous === frames) return false;
    cameraKey = key; previous = frames;
    camera.updateMatrixWorld?.();
    const candidates = frames.flatMap(frame => {
      const profile = ornamentalDecorationProfile(frame.item, detailed);
      if (!profile) return [];
      const distance = Math.hypot(frame.position[0] - x, frame.position[1] - y, frame.position[2] - z);
      const range = profile.large ? 45 : 16;
      let readable = distance < range, priority = distance, pixels = 40, inFrame = readable, threshold = 0;
      if (camera.projectionMatrix && camera.matrixWorldInverse) {
        let height = .9;
        threshold = 70;
        if (profile.large) { height = 6; threshold = 220; }
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (const box of frame.volumes) {
          minX = Math.min(minX, box.min[0]); minY = Math.min(minY, box.min[1]); minZ = Math.min(minZ, box.min[2]);
          maxX = Math.max(maxX, box.max[0]); maxY = Math.max(maxY, box.max[1]); maxZ = Math.max(maxZ, box.max[2]);
        }
        let span = height;
        if (Number.isFinite(minY)) {
          height = maxY - minY; span = Math.max(height, Math.hypot(maxX - minX, maxZ - minZ));
        }
        point.set(frame.position[0], frame.position[1] + height * .5, frame.position[2]);
        point.applyMatrix4(camera.matrixWorldInverse);
        pixels = span * projectionScale * viewportHeight * .5;
        if (!camera.isOrthographicCamera) pixels /= Math.max(1, -point.z);
        point.applyMatrix4(camera.projectionMatrix);
        inFrame = Math.abs(point.x) < 1.5 && Math.abs(point.y) < 1.5;
        readable = pixels >= threshold && inFrame;
        priority = point.x ** 2 + point.y ** 2;
      }
      return [{ uid: frame.uid, priority, readable, inFrame, threshold, cost: profile.cost,
        farCost: profile.farCost, pixels, overview: profile.overview }];
    }).sort((first, last) => {
      // Items that were near in the previous frame keep their charge and order first.
      const firstNear = tiers.get(first.uid) === "near" ? 0 : 1;
      const lastNear = tiers.get(last.uid) === "near" ? 0 : 1;
      return firstNear - lastNear || first.priority - last.priority || first.uid - last.uid;
    });
    // A bounded close-detail allowance keeps one repeated premium tree from multiplying hero cost.
    let remaining = detailed ? 60000 : 24000;
    let totalRemaining = (detailed ? 100000 : 60000) - candidates.length * 2;
    const next = new Map<number, OrnamentalPlantTier>();
    for (const candidate of candidates) {
      const wasNear = tiers.get(candidate.uid) === "near";
      // A near item keeps its detail down to 80% of the entry threshold, so a small pan does not pop.
      const readable = candidate.readable ||
        (wasNear && candidate.inFrame && candidate.threshold > 0 &&
          candidate.pixels >= candidate.threshold * .8);
      if (readable && candidate.cost <= remaining && candidate.cost - 2 <= totalRemaining) {
        next.set(candidate.uid, "near"); remaining -= candidate.cost; totalRemaining -= candidate.cost - 2;
      } else if (!candidate.overview || candidate.pixels >= 35 && candidate.farCost - 2 <= totalRemaining) {
        next.set(candidate.uid, "far"); totalRemaining -= candidate.farCost - 2;
      } else next.set(candidate.uid, "overview");
    }
    const changed = next.size !== tiers.size || [...next].some(([uid, tier]) => tiers.get(uid) !== tier);
    tiers = next;
    return changed;
  };
  return { update, tierFor: (uid: number): OrnamentalPlantTier => tiers.get(uid) ?? "near",
    dispose: () => { previous = undefined; tiers.clear(); } };
};
