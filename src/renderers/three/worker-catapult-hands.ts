import { Object3D, Quaternion } from "three";

import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import { createWorkerHandcartGrip } from "./worker-handcart-grip";

/** Extra contact convergence keeps both palms on the traverse bar and its moving release lever. */
export const createWorkerCatapultHands = (root: Object3D) => {
  const joints = ["LeftArm", "LeftForeArm", "RightArm", "RightForeArm"].map(name => root.getObjectByName(name));
  const base = joints.map(() => new Quaternion());
  const grip = createWorkerHandcartGrip(root, 16), handles = new Object3D();
  const points = ["left", "right"].map(side => {
    const point = new Object3D(); point.name = `cart_grip_${side}`; handles.add(point); return point;
  });
  return {
    apply: (frame: WorkerFrame) => {
      if (!frame.catapultHands) return;
      points.forEach((point, index) => point.position.set(...frame.catapultHands![index]!));
      handles.updateMatrixWorld(true); root.updateWorldMatrix(true, false);
      joints.forEach((joint, index) => joint && base[index]!.copy(joint.quaternion)); grip.apply(handles);
      const weight = Math.max(0, Math.min(1, frame.catapultHandWeight ?? 1));
      if (weight < 1) joints.forEach((joint, index) => joint?.quaternion.slerp(base[index]!, 1 - weight));
      root.updateMatrixWorld(true);
    },
    reset: grip.reset
  };
};
