import { Box3, type Object3D, Vector3 } from "three";

import { hideCarryPivot } from "./worker-hide-transfer";
import { createPropSurfaceSampler } from "./worker-prop-surface";

/** Flat leather and a folded raw skin are held ahead of the chest, clear of the neck and original hair. */
export const SOFT_HAND_LOADS = ["hides", "leather"];
export const isSoftHandLoad = (ware: string | null | undefined) => SOFT_HAND_LOADS.includes(ware ?? "");
const placements = new WeakMap<Object3D, { pivot: Vector3; offset: Vector3 }>();
export const placeSoftHandLoad = (prop: Object3D, ware: string) => {
  let placement = placements.get(prop);
  if (!placement) {
    const pivot = hideCarryPivot(prop)?.clone() ?? new Vector3();
    if (ware !== "hides") {
      const surface = createPropSurfaceSampler(prop), bounds = surface.bounds(new Box3());
      surface.closest(new Vector3(0, bounds.min.y - .02, bounds.min.z - .02), pivot);
    }
    placement = { pivot, offset: new Vector3() }; placements.set(prop, placement);
  }
  if (ware === "hides") prop.rotation.set(Math.PI / 2, Math.PI, 0, "YXZ");
  else prop.quaternion.identity();
  // Bind the held edge, not the load centre: different legitimate stock scales keep the same reachable grip.
  placement.offset.copy(placement.pivot).multiply(prop.scale).applyQuaternion(prop.quaternion);
  prop.position.set(0, .88, .25).sub(placement.offset);
};
