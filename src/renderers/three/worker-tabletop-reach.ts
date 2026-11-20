import { type Object3D, Quaternion, Vector3 } from "three";

import { WORKER_HEIGHT } from "../../render-common/workers/worker-dimensions";
import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import { smoothstep01 } from "../../shared/world/noise";
import { createGroundedKneePlacement } from "./worker-grounded-knees";
import { transferCarryWeight } from "./worker-ware-transfer";

/** Reach over a workbench with the original standing soles planted, without a ground pickup crouch. */
export const createTabletopTransferReach = (root: Object3D) => {
  const spine = root.getObjectByName("Spine"), hips = root.getObjectByName("Hips");
  const plantKnees = createGroundedKneePlacement(root);
  const legs = ["Left", "Right"].map(side => ({
    upper: root.getObjectByName(`${side}UpLeg`), lower: root.getObjectByName(`${side}Leg`),
    foot: root.getObjectByName(`${side}Foot`), target: new Vector3(), orientation: new Quaternion(),
    upperPose: new Quaternion(), lowerPose: new Quaternion(), footPose: new Quaternion()
  }));
  const spinePose = new Quaternion(), hipsPose = new Vector3(), axis = new Vector3();
  const world = new Quaternion(), parent = new Quaternion(), delta = new Quaternion(), point = new Vector3();
  let adjusted = false;
  return {
    reset() {
      if (!adjusted || !hips || !spine) return;
      hips.position.copy(hipsPose); spine.quaternion.copy(spinePose);
      for (const leg of legs) {
        leg.upper?.quaternion.copy(leg.upperPose); leg.lower?.quaternion.copy(leg.lowerPose);
        leg.foot?.quaternion.copy(leg.footPose);
      }
      adjusted = false;
    },
    apply(frame: WorkerFrame) {
      const transfer = frame.wareTransfer;
      if (!hips?.parent || !spine?.parent || !transfer || (transfer.ware !== "leather" && transfer.presentation !== "hanging") ||
        transfer.target.y - frame.y < WORKER_HEIGHT / 2) return;
      const progress = transfer.progress;
      const contact = transfer.direction === "pickup" ? smoothstep01(progress / .3)
        : 1 - smoothstep01((progress - .74) / .22);
      const weight = contact * (1 - transferCarryWeight(transfer));
      if (weight <= 0) return;
      hipsPose.copy(hips.position); spinePose.copy(spine.quaternion); adjusted = true;
      root.updateMatrixWorld(true);
      for (const leg of legs) {
        leg.upperPose.copy(leg.upper!.quaternion); leg.lowerPose.copy(leg.lower!.quaternion);
        leg.footPose.copy(leg.foot!.quaternion);
        leg.foot!.getWorldPosition(leg.target); leg.foot!.getWorldQuaternion(leg.orientation);
      }
      const hanging = transfer.presentation === "hanging";
      axis.set(0, -.005 * weight, (hanging ? .04 : .025) * weight).applyQuaternion(root.getWorldQuaternion(world));
      hips.getWorldPosition(point).add(axis); hips.parent.worldToLocal(point); hips.position.copy(point);
      root.updateMatrixWorld(true);
      axis.set(1, 0, 0).applyQuaternion(root.getWorldQuaternion(world));
      spine.getWorldQuaternion(world); delta.setFromAxisAngle(axis, (hanging ? .15 : .08) * weight);
      spine.quaternion.copy(spine.parent.getWorldQuaternion(parent).invert().multiply(delta.multiply(world)));
      root.updateMatrixWorld(true);
      for (const { foot, lower, orientation, target, upper } of legs) {
        if (!upper || !lower || !foot?.parent) continue;
        plantKnees(upper, lower, foot, target);
        foot.quaternion.copy(foot.parent.getWorldQuaternion(parent).invert().multiply(orientation));
      }
      root.updateMatrixWorld(true);
    }
  };
};
