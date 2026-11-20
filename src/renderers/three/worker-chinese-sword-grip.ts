import { type Object3D, Quaternion, Vector3 } from "three";

import { type MeleePose, weaponDirection, weaponEdge } from "./worker-melee-tracks";

/** Both palms keep the long sword on the same shaft while the lower body retains its gait. */
export const chineseSwordTravelPose = (guard: MeleePose): MeleePose => {
  const pitch = .3, yaw = -.2, direction = weaponDirection(pitch, yaw);
  const rightHand: [number, number, number] = [-.07, .72, .25];
  const leftAlong = guard.leftAlong ?? -.15;
  const leftHand = rightHand.map((value, axis) => value + direction[axis]! * leftAlong) as [number, number, number];
  return { ...guard, bend: 0, body: undefined, lean: 0, leftHand, pitch, rightHand,
    shield: false, sweep: false, twist: 0, yaw };
};

const shaft = new Vector3(), edge = new Vector3(), knuckles = new Vector3();
const first = new Vector3(), last = new Vector3(), origin = new Vector3(), cross = new Vector3();
const rotation = new Quaternion(), rootRotation = new Quaternion(), parent = new Quaternion();

/** Shaft alignment leaves one free rotation: align the knuckle-facing direction with the cutting edge. */
export const alignChineseSwordWrist = (root: Object3D, hand: Object3D,
  index: Object3D, pinky: Object3D, pose: MeleePose) => {
  if (!hand.parent) return;
  root.updateMatrixWorld(true);
  root.getWorldQuaternion(rootRotation);
  shaft.fromArray(weaponDirection(pose.pitch, pose.yaw)).applyQuaternion(rootRotation).normalize();
  edge.fromArray(weaponEdge(pose)).applyQuaternion(rootRotation).normalize();
  knuckles.copy(index.getWorldPosition(first)).add(pinky.getWorldPosition(last)).multiplyScalar(.5)
    .sub(hand.getWorldPosition(origin));
  knuckles.addScaledVector(shaft, -knuckles.dot(shaft));
  if (knuckles.lengthSq() < 1e-10) return;
  knuckles.normalize();
  const angle = Math.atan2(shaft.dot(cross.crossVectors(knuckles, edge)), knuckles.dot(edge));
  rotation.setFromAxisAngle(shaft, angle).multiply(hand.getWorldQuaternion(parent));
  hand.quaternion.copy(hand.parent.getWorldQuaternion(parent).invert().multiply(rotation));
  root.updateMatrixWorld(true);
};
