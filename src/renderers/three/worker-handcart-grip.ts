import { Object3D, Quaternion, Vector3 } from "three";

import { HANDCART_GRIP } from "../../render-common/logistics/handcart-rules";
import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import { createTwoBoneArmApplicator } from "./worker-two-bone-arm";

/** Two real palm sockets meet the cart handles; there is no second navigating follower. */
export const createWorkerHandcartGrip = (root: Object3D, contactPasses = 5) => {
  const arms = ["Left", "Right"].map(side => ({
    side, upper: root.getObjectByName(`${side}Arm`), lower: root.getObjectByName(`${side}ForeArm`),
    hand: root.getObjectByName(`${side}Hand`), socket: root.getObjectByName(`socket_hand_${side === "Left" ? "L" : "R"}`),
    upperPose: new Quaternion(), lowerPose: new Quaternion()
  }));
  const parent = new Quaternion();
  const applyArm = createTwoBoneArmApplicator(root);
  const end = new Vector3(), target = new Vector3();
  const pole = new Vector3(), offset = new Vector3();
  let applied = false;
  return {
    reset: () => {
      if (!applied) return;
      for (const arm of arms) {
        arm.upper?.quaternion.copy(arm.upperPose); arm.lower?.quaternion.copy(arm.lowerPose);
      }
      applied = false;
    },
    apply: (cart: Object3D) => {
      root.updateMatrixWorld(true); cart.updateMatrixWorld(true);
      for (const arm of arms) {
        if (!arm.upper?.parent || !arm.lower?.parent || !arm.hand || !arm.socket) continue;
        const handle = cart.getObjectByName(`cart_grip_${arm.side.toLowerCase()}`);
        if (!handle) continue;
        arm.upperPose.copy(arm.upper.quaternion); arm.lowerPose.copy(arm.lower.quaternion);
        const grip = handle.getWorldPosition(new Vector3());
        for (let pass = 0; pass < contactPasses; pass++) {
          root.updateMatrixWorld(true);
          target.copy(grip).sub(arm.socket.getWorldPosition(offset).sub(arm.hand.getWorldPosition(end)));
          pole.set(arm.side === "Left" ? .3 : -.3, -.8, -.4).applyQuaternion(root.getWorldQuaternion(parent));
          applyArm(arm.upper, arm.lower, arm.hand, target, pole);
        }
      }
      applied = true;
    },
    contactError: (cart: Object3D) => {
      root.updateMatrixWorld(true); cart.updateMatrixWorld(true);
      return arms.map(arm => {
        const handle = cart.getObjectByName(`cart_grip_${arm.side.toLowerCase()}`);
        return arm.socket && handle ? arm.socket.getWorldPosition(new Vector3())
          .distanceTo(handle.getWorldPosition(new Vector3())) : Infinity;
      });
    }
  };
};

/**
 * The game worker's hands on the shafts of the cart it pulls (frame.handcart): a light stand-in
 * carries the two grip points at the cart's pose, so no cart model is needed in the worker scene.
 */
export const createWorkerHandcartPull = (root: Object3D) => {
  const grip = createWorkerHandcartGrip(root);
  const cart = new Object3D();
  cart.rotation.order = "YXZ";
  for (const [name, x] of [["cart_grip_left", HANDCART_GRIP.x], ["cart_grip_right", -HANDCART_GRIP.x]] as const) {
    const point = new Object3D();
    point.name = name;
    point.position.set(x, HANDCART_GRIP.y, HANDCART_GRIP.z);
    cart.add(point);
  }
  return {
    apply: (frame: WorkerFrame) => {
      const pose = frame.handcart;
      if (!pose) return;
      cart.position.set(pose.x, pose.y, pose.z);
      cart.rotation.set(-pose.pitch, pose.yaw, 0);
      cart.updateMatrixWorld(true);
      // The crowd member moved its group this frame: the hands must reach from the new place.
      root.updateWorldMatrix(true, false);
      grip.apply(cart);
    },
    reset: grip.reset
  };
};
