import { type Object3D,Quaternion, Vector3 } from "three";

import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import { smoothstep01 } from "../../shared/world/noise";
import { createTwoBoneArmApplicator } from "./worker-two-bone-arm";

export type CradleTransfer = NonNullable<WorkerFrame["wareTransfer"]>;
export interface CradleSupport {
  contactWeight?: (transfer: CradleTransfer) => number;
  wristLift?: (transfer: CradleTransfer, lift: number) => number;
  prepare: (ware: Object3D, transfer: CradleTransfer) => number;
  target: (target: Vector3, sign: number, lift: number, carryOnly: boolean) => void;
  supportName: string;
}

const transferReach = (transfer: CradleTransfer) => transfer.direction === "pickup"
  ? smoothstep01(transfer.progress / .3) : 1 - smoothstep01((transfer.progress - .64) / .1);
const transferLift = (transfer: CradleTransfer) => transfer.direction === "pickup"
  ? smoothstep01((transfer.progress - .4) / .55) : 1 - smoothstep01(transfer.progress / .72);

/** Shared contact iteration; ware-specific support surfaces remain with each recipe. */
export const createCradleCarry = (root: Object3D, supportSurface: CradleSupport) => {
  const arms = ["Left", "Right"].map(side => ({
    side,
    upper: root.getObjectByName(`${side}Arm`), lower: root.getObjectByName(`${side}ForeArm`),
    hand: root.getObjectByName(`${side}Hand`), socket: root.getObjectByName(`socket_hand_${side === "Left" ? "L" : "R"}`),
    upperPose: new Quaternion(), lowerPose: new Quaternion(), handPose: new Quaternion(), adjusted: false
  }));
  const reset = () => {
    for (const arm of arms) {
      if (!arm.adjusted) continue;
      arm.upper?.quaternion.copy(arm.upperPose); arm.lower?.quaternion.copy(arm.lowerPose); arm.hand?.quaternion.copy(arm.handPose);
      arm.adjusted = false;
    }
  };
  const applyArm = createTwoBoneArmApplicator(root);
  const target = new Vector3(), socketOffset = new Vector3(), end = new Vector3(), pole = new Vector3();
  const parent = new Quaternion();
  const originalUpper = new Quaternion(), originalLower = new Quaternion();
  const wrist = new Quaternion(), wristDelta = new Quaternion(), axis = new Vector3();
  const apply = (ware: Object3D, transfer: CradleTransfer, carryOnly = false) => {
    const passes = supportSurface.prepare(ware, transfer);
    if (passes === 0) return;
    const weight = carryOnly ? 1 : supportSurface.contactWeight?.(transfer) ?? transferReach(transfer);
    const lift = carryOnly ? 1 : transferLift(transfer);
    const wristLift = supportSurface.wristLift?.(transfer, lift) ?? lift;
    if (weight <= 0) return;
    for (const arm of arms) {
      const { hand, handPose, lower, lowerPose, side, socket, upper, upperPose } = arm;
      const handWeight = weight;
      const sign = side === "Left" ? 1 : -1;
      if (!upper?.parent || !lower?.parent || !hand || !socket) continue;
      arm.adjusted = true;
      upperPose.copy(upper.quaternion); lowerPose.copy(lower.quaternion); handPose.copy(hand.quaternion);
      root.updateMatrixWorld(true);
      axis.set(1, 0, 0).applyQuaternion(root.getWorldQuaternion(parent));
      wrist.copy(hand.getWorldQuaternion(wrist));
      wrist.premultiply(wristDelta.setFromAxisAngle(axis, -Math.PI / 2 * wristLift));
      originalUpper.copy(upperPose); originalLower.copy(lowerPose);
      for (let pass = 0; pass < passes; pass++) {
        hand.quaternion.copy(hand.parent!.getWorldQuaternion(parent).invert().multiply(wrist));
        root.updateMatrixWorld(true);
        supportSurface.target(target, sign, lift, carryOnly);
        ware.localToWorld(target);
        ware.userData[`${supportSurface.supportName}${side}`] = target.toArray();
        socketOffset.copy(socket.getWorldPosition(socketOffset)).sub(hand.getWorldPosition(end));
        target.sub(socketOffset);
        pole.set(-sign * (ware.userData.catapultTucked ? .12 : .5), ware.userData.catapultTucked ? -.9 : -.8,
          ware.userData.catapultTucked ? .15 : -.3)
          .applyQuaternion(root.getWorldQuaternion(parent));
        applyArm(upper, lower, hand, target, pole);
      }
      upper.quaternion.slerp(originalUpper, 1 - handWeight);
      lower.quaternion.slerp(originalLower, 1 - handWeight);
      hand.quaternion.copy(hand.parent!.getWorldQuaternion(parent).invert().multiply(wrist)).slerp(handPose, 1 - handWeight);
      root.updateMatrixWorld(true);
    }
  };
  return { apply, reset };
};
