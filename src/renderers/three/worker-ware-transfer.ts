import { solveTwoBone } from "@workers/retarget/two-bone-ik";
import { type Object3D,Quaternion, Vector3 } from "three";

import { getWareCarryAction } from "../../render-common/wares/ware-catalog";
import { WORKER_HEIGHT } from "../../render-common/workers/worker-dimensions";
import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import { smoothstep01 } from "../../shared/world/noise";
import { placeTransferredHide } from "./worker-hide-transfer";

/** Weight of the original shoulder/back pose at either end of a one-shot transfer. */
export const transferCarryWeight = (transfer: NonNullable<WorkerFrame["wareTransfer"]>) =>
  transfer.direction === "pickup"
    ? smoothstep01((transfer.progress - 0.8) / 0.2)
    : 1 - smoothstep01(transfer.progress / 0.18);

/** Stock contact is in island coordinates; carried loads live in the worker's local space. */
export const placeTransferredWare = (
  prop: Object3D,
  root: Object3D,
  transfer: NonNullable<WorkerFrame["wareTransfer"]>
) => {
  const carry = prop.position.clone();
  const carryScale = prop.scale.clone();
  const carryRotation = prop.quaternion.clone();
  const target = root.worldToLocal(new Vector3(transfer.target.x, transfer.target.y, transfer.target.z));
  const targetRotation = root.getWorldQuaternion(new Quaternion()).invert()
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), transfer.yaw ?? 0));
  // Grain's transport shape is rotated across the back, but stock bundles lie along the bay.
  const shape = prop.getObjectByName("ware_geometry");
  if (shape) targetRotation.multiply(shape.quaternion.clone().invert());
  const lift = transfer.direction === "pickup"
    ? smoothstep01((transfer.progress - 0.4) / 0.55)
    : 1 - smoothstep01(transfer.progress / 0.72);
  prop.position.copy(target).lerp(carry, lift);
  prop.quaternion.copy(targetRotation).slerp(carryRotation, lift);
  if (transfer.pour) prop.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),
    -Math.sin(Math.PI * transfer.progress) * 1.15));
  const worldScale = root.getWorldScale(new Vector3()).x;
  const targetScale = (transfer.scale ?? worldScale) / worldScale;
  const scale = transfer.scale3;
  const targetDimensions = new Vector3(
    scale?.x ?? targetScale * worldScale,
    scale?.y ?? targetScale * worldScale,
    scale?.z ?? targetScale * worldScale
  );
  applyCarriedWareScale(prop, root, targetDimensions);
  prop.scale.lerp(carryScale, lift);
  if (transfer.presentation === "hanging" && placeTransferredHide(prop,
    { position: target, rotation: targetRotation, scale: targetDimensions.divideScalar(worldScale) },
    { position: carry, rotation: carryRotation, scale: carryScale }, lift)) return;
  // Lift clear of the bench before bringing a flat load across its edge; ground transfers retain their path.
  if (transfer.ware === "leather" && transfer.target.y - root.getWorldPosition(target).y >= WORKER_HEIGHT / 2)
    prop.position.y += Math.sin(Math.PI * lift) * .12 / worldScale;
};

export const applyCarriedWareScale = (
  prop: Object3D, root: Object3D, scale: { x: number; y: number; z: number } | undefined, catapultStone?: boolean
) => {
  if (catapultStone !== undefined) prop.userData.catapultStone = catapultStone;
  if (!scale) { prop.scale.setScalar(1); return; }
  const target = new Vector3(scale.x, scale.y, scale.z);
  const shape = prop.getObjectByName("ware_geometry");
  if (shape) target.applyQuaternion(shape.quaternion.clone().invert());
  const worldScale = root.getWorldScale(new Vector3()).x;
  prop.scale.set(Math.abs(target.x) / worldScale, Math.abs(target.y) / worldScale, Math.abs(target.z) / worldScale);
};

const namedBone = (joints: ReadonlyMap<string, Object3D>, name: string) =>
  [...joints.values()].find((joint) => joint.name.replace(/[^a-z]/gi, "").endsWith(name));

/** Keep hands on the moving load using the body's own Mixamo joints, after its baked clip. */
export const createTransferHandContacts = (root: Object3D, joints: ReadonlyMap<string, Object3D>) => {
  const arms = ["Left", "Right"].map((side) => ({
    side,
    upper: namedBone(joints, `${side}Arm`),
    lower: namedBone(joints, `${side}ForeArm`),
    hand: namedBone(joints, `${side}Hand`),
    socket: joints.get(`socket_hand_${side === "Left" ? "L" : "R"}`)
  }));
  const target = new Vector3(), socketPosition = new Vector3(), handPosition = new Vector3();
  const shoulder = new Vector3(), elbow = new Vector3(), end = new Vector3(), pole = new Vector3();
  const upperWorld = new Quaternion(), lowerWorld = new Quaternion(), parent = new Quaternion();
  const originalUpper = new Quaternion(), originalLower = new Quaternion();
  return (prop: Object3D, transfer: NonNullable<WorkerFrame["wareTransfer"]>) => {
    const carrying = transferCarryWeight(transfer);
    if (carrying >= .999) return;
    let contact = 1;
    if (!transfer.pour) contact = transfer.direction === "putdown"
      ? 1 - smoothstep01((transfer.progress - .74) / .22) : smoothstep01(transfer.progress / .3);
    const weight = contact * (1 - carrying);
    if (weight <= 0) return;
    for (const { hand, lower, side, socket, upper } of arms) {
      if (!upper?.parent || !lower?.parent || !hand || !socket) continue;
      root.updateMatrixWorld(true);
      prop.localToWorld(target.set(side === "Left" ? .075 : -.075, -.025, 0));
      target.sub(socket.getWorldPosition(socketPosition).sub(hand.getWorldPosition(handPosition)));
      upper.getWorldQuaternion(upperWorld); lower.getWorldQuaternion(lowerWorld);
      originalUpper.copy(upper.quaternion); originalLower.copy(lower.quaternion);
      const result = solveTwoBone({root: upper.getWorldPosition(shoulder),
        middle: lower.getWorldPosition(elbow), end: hand.getWorldPosition(end)},
      target, pole.set(side === "Left" ? 1 : -1, -.4, .3));
      upper.quaternion.copy(upper.parent.getWorldQuaternion(parent).invert()
        .multiply(result.rootDelta.multiply(upperWorld))).slerp(originalUpper, 1 - weight);
      root.updateMatrixWorld(true);
      lower.quaternion.copy(lower.parent.getWorldQuaternion(parent).invert()
        .multiply(result.middleDelta.multiply(lowerWorld))).slerp(originalLower, 1 - weight);
      root.updateMatrixWorld(true);
    }
  };
};

export const transferCarryAction = (frame: WorkerFrame) =>
  (frame.wareTransfer?.ware ?? frame.carryingWare) === "boat" ? "carry_overhead_boat" :
    getWareCarryAction(frame.wareTransfer?.ware ?? frame.carryingWare ?? "flour");
