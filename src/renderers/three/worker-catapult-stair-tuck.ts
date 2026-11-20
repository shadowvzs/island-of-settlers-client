import { type Object3D, Quaternion, Vector3 } from "three";

import type { WorkerFrame } from "../../render-common/workers/worker-unit";

/** An actual forward duck while passing the hatch, without changing any body or helmet scale. */
export const createWorkerCatapultStairTuck = (root: Object3D) => {
  const joints = [[root.getObjectByName("Spine"), .12], [root.getObjectByName("Neck"), .08]] as const;
  const original = joints.map(() => new Quaternion()), world = new Quaternion(), parent = new Quaternion();
  const axis = new Vector3(), delta = new Quaternion();
  let applied = false;
  return {
    reset: () => {
      if (!applied) return;
      joints.forEach(([joint], index) => joint?.quaternion.copy(original[index]!)); applied = false;
    },
    apply: (frame: WorkerFrame) => {
      if (!frame.catapultTuckedCarry) return;
      axis.set(1, 0, 0).applyQuaternion(root.getWorldQuaternion(world));
      joints.forEach(([joint, angle], index) => {
        if (!joint?.parent) return;
        original[index]!.copy(joint.quaternion);
        joint.getWorldQuaternion(world); delta.setFromAxisAngle(axis, angle);
        joint.quaternion.copy(joint.parent.getWorldQuaternion(parent).invert().multiply(delta.multiply(world)));
        root.updateMatrixWorld(true);
      });
      applied = true;
    }
  };
};
