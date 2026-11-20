import { type Object3D, Quaternion, Vector3 } from "three";

import { DRINK_MOTION_SECONDS, expansionDrinkHandTarget } from "../../render-common/buildings/expansion-drink-motion";
import { isDrinkWorkAction, sampleDrinkHand } from "../../render-common/workers/drink-work-actions";
import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import { createTwoBoneArmApplicator } from "./worker-two-bone-arm";

/** Individual picking, pressing, grinding, pouring and stirring motions on the existing settler rig. */
export const createWorkerDrinkWork = (root: Object3D) => {
  const arms = ["Left", "Right"].map(side => ({ side,
    upper: root.getObjectByName(`${side}Arm`), lower: root.getObjectByName(`${side}ForeArm`),
    hand: root.getObjectByName(`${side}Hand`), socket: root.getObjectByName(`socket_hand_${side[0]}`)
  }));
  const applyArm = createTwoBoneArmApplicator(root);
  const target = new Vector3(), offset = new Vector3(), handEnd = new Vector3(), pole = new Vector3();
  const rotation = new Quaternion(), parent = new Quaternion(), wrist = new Quaternion();
  const axis = new Vector3(1, 0, 0), twistAxis = new Vector3(0, 1, 0), twist = new Quaternion();
  return (frame: WorkerFrame) => {
    if (!isDrinkWorkAction(frame.action)) return;
    const wave = Math.sin(frame.animationTime / DRINK_MOTION_SECONDS * Math.PI * 2);
    for (const arm of arms) {
      if (!arm.upper?.parent || !arm.lower?.parent || !arm.hand?.parent) continue;
      const right = arm.side === "Right";
      const point = sampleDrinkHand(frame.action, frame.animationTime, right);
      root.updateMatrixWorld(true);
      if (frame.drinkWork) target.set(...expansionDrinkHandTarget(frame.drinkWork, right));
      else root.localToWorld(target.set(...point));
      root.getWorldQuaternion(rotation);
      wrist.copy(rotation).multiply(twist.setFromAxisAngle(axis,
        frame.action === "grind_cacao" ? Math.PI / 2 : .25));
      if (right && ["pick_pomegranate", "brew_tea", "infuse_berries"].includes(frame.action))
        wrist.multiply(twist.setFromAxisAngle(twistAxis, wave * .35));
      arm.hand.quaternion.copy(arm.hand.parent.getWorldQuaternion(parent).invert().multiply(wrist));
      for (let pass = 0; pass < 2; pass++) {
        root.updateMatrixWorld(true);
        if (arm.socket) {
          offset.copy(arm.socket.getWorldPosition(offset)).sub(arm.hand.getWorldPosition(handEnd));
        } else offset.set(0, 0, 0);
        const aim = handEnd.copy(target).sub(offset);
        pole.set(right ? .5 : -.5, -.8, -.3).applyQuaternion(rotation);
        applyArm(arm.upper, arm.lower, arm.hand, aim, pole);
      }
      arm.hand.quaternion.copy(arm.hand.parent.getWorldQuaternion(parent).invert().multiply(wrist));
    }
    root.updateMatrixWorld(true);
  };
};
