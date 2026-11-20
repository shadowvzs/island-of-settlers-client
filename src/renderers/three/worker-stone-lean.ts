import { solveTwoBone } from "@workers/retarget/two-bone-ik";
import { type Object3D,Quaternion, Vector3 } from "three";

import { stoneWareAppearance } from "../../render-common/wares/advanced-material-variants";
import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import { smoothstep01 } from "../../shared/world/noise";
import { catapultPickupCrouch } from "./catapult-pickup-crouch";

export const createStonePickupLean = (root: Object3D) => {
  const spine = root.getObjectByName("Spine"), hips = root.getObjectByName("Hips");
  const legs = ["Left", "Right"].map(side => ({
    upper: root.getObjectByName(`${side}UpLeg`), lower: root.getObjectByName(`${side}Leg`),
    foot: root.getObjectByName(`${side}Foot`), target: new Vector3(), orientation: new Quaternion(),
    upperPose: new Quaternion(), lowerPose: new Quaternion(), footPose: new Quaternion()
  }));
  const axis = new Vector3(), world = new Quaternion(), parent = new Quaternion(), delta = new Quaternion();
  const original = new Quaternion(), hipsPosition = new Vector3(), position = new Vector3();
  const shoulder = new Vector3(), elbow = new Vector3(), end = new Vector3(), pole = new Vector3();
  const upperWorld = new Quaternion(), lowerWorld = new Quaternion();
  let adjusted = false;
  const reset = () => {
    if (!adjusted || !spine || !hips) return;
    spine.quaternion.copy(original); hips.position.copy(hipsPosition);
    for (const leg of legs) {
      leg.upper?.quaternion.copy(leg.upperPose); leg.lower?.quaternion.copy(leg.lowerPose);
      leg.foot?.quaternion.copy(leg.footPose);
    }
    adjusted = false;
  };
  const apply = (frame: WorkerFrame) => {
    if (!spine?.parent || !hips?.parent || !(stoneWareAppearance(frame.wareTransfer?.ware ?? "") ||
      ["stone", "bread"].includes(frame.wareTransfer?.ware ?? ""))) return;
    if (!frame.wareTransfer) return;
    const pickup = frame.wareTransfer.direction === "pickup";
    const progress = frame.wareTransfer.progress;
    const reach = pickup ? smoothstep01(progress / .3) * (1 - smoothstep01((progress - .4) / .55)) :
      smoothstep01(progress / .25) * (1 - smoothstep01((progress - .72) / .2));
    const high = frame.wareTransfer.target.y - frame.y > .75;
    const lean = high ? 0 : reach;
    const catapult = frame.catapultStoneDiameter !== undefined;
    const crouch = catapult ? catapultPickupCrouch(lean, progress, pickup && !high) : .08 * lean;
    original.copy(spine.quaternion); hipsPosition.copy(hips.position);
    adjusted = true;
    root.updateMatrixWorld(true);
    for (const leg of legs) {
      leg.upperPose.copy(leg.upper!.quaternion); leg.lowerPose.copy(leg.lower!.quaternion);
      leg.footPose.copy(leg.foot!.quaternion);
      leg.foot!.getWorldPosition(leg.target); leg.foot!.getWorldQuaternion(leg.orientation);
    }
    root.getWorldQuaternion(world);
    axis.set(0, -crouch, (catapult ? .16 : .3) * lean).applyQuaternion(world);
    hips.getWorldPosition(position).add(axis); hips.parent.worldToLocal(position);
    hips.position.copy(position);
    root.updateMatrixWorld(true);
    axis.set(1, 0, 0).applyQuaternion(root.getWorldQuaternion(world));
    spine.getWorldQuaternion(world);
    delta.setFromAxisAngle(axis, (catapult ? .9 : .6) * lean);
    spine.quaternion.copy(spine.parent.getWorldQuaternion(parent).invert().multiply(delta.multiply(world)));
    root.updateMatrixWorld(true);
    for (const { foot, lower, orientation, target, upper } of legs) {
      if (!upper?.parent || !lower?.parent || !foot?.parent) continue;
      for (let pass = 0; pass < 3; pass++) {
        upper.getWorldQuaternion(upperWorld); lower.getWorldQuaternion(lowerWorld);
        pole.set(0, 0, 1).applyQuaternion(root.getWorldQuaternion(parent));
        const solution = solveTwoBone({ root: upper.getWorldPosition(shoulder),
          middle: lower.getWorldPosition(elbow), end: foot.getWorldPosition(end) }, target, pole);
        upper.quaternion.copy(upper.parent.getWorldQuaternion(parent).invert()
          .multiply(solution.rootDelta.multiply(upperWorld)));
        root.updateMatrixWorld(true);
        lower.quaternion.copy(lower.parent.getWorldQuaternion(parent).invert()
          .multiply(solution.middleDelta.multiply(lowerWorld)));
        root.updateMatrixWorld(true);
      }
      foot.quaternion.copy(foot.parent.getWorldQuaternion(parent).invert().multiply(orientation));
      root.updateMatrixWorld(true);
    }
  };
  return { apply, reset };
};

