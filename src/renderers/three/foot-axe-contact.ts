import { solveTwoBone } from "@workers/retarget/two-bone-ik";
import { type Object3D, Quaternion, Vector3 } from "three";

import type { Point3 } from "./worker-melee-tracks";

/** Project the two real palms together into the original arms' reachable intersection. */
export const createFootAxeContactAlignment = (root: Object3D, sockets: readonly Object3D[]) => {
  const arms = ["Left", "Right"].map((side, index) => ({
    upper: root.getObjectByName(`${side}Arm`)!, lower: root.getObjectByName(`${side}ForeArm`)!,
    hand: root.getObjectByName(`${side}Hand`)!, index: root.getObjectByName(`${side}HandIndex1`)!,
    pinky: root.getObjectByName(`${side}HandPinky1`)!, socket: sockets[index]!,
    contact: new Vector3(), centre: new Vector3(), radius: 0, rotation: new Quaternion()
  }));
  const centre = new Vector3(), axis = new Vector3(), across = new Vector3(), radial = new Vector3(), toward = new Vector3();
  const shoulder = new Vector3(), elbow = new Vector3(), end = new Vector3(), offset = new Vector3(), point = new Vector3();
  const cross = new Vector3(), target = new Vector3(), pole = new Vector3();
  const parent = new Quaternion(), upper = new Quaternion(), lower = new Quaternion(), turn = new Quaternion();
  const orient = (arm: typeof arms[number], pass: number) => {
    across.copy(arm.index.getWorldPosition(point)).sub(arm.pinky.getWorldPosition(end)).normalize();
    arm.rotation.copy(arm.hand.getWorldQuaternion(upper)).premultiply(turn.setFromUnitVectors(across, axis));
    arm.hand.quaternion.copy(arm.hand.parent!.getWorldQuaternion(parent).invert().multiply(arm.rotation));
    if (pass === 0) {
      radial.copy(arm.socket.getWorldPosition(offset)).sub(arm.hand.getWorldPosition(end));
      radial.addScaledVector(axis, -radial.dot(axis)).normalize();
      toward.copy(arm.contact).sub(arm.upper.getWorldPosition(shoulder));
      toward.addScaledVector(axis, -toward.dot(axis)).normalize();
      const angle = Math.atan2(cross.crossVectors(radial, toward).dot(axis), radial.dot(toward));
      arm.rotation.premultiply(turn.setFromAxisAngle(axis, Math.max(-1.2, Math.min(1.2, angle))));
      arm.hand.quaternion.copy(arm.hand.parent!.getWorldQuaternion(parent).invert().multiply(arm.rotation));
    }
  };
  const solve = (arm: typeof arms[number], index: number) => {
    for (let pass = 0; pass < 4; pass++) {
      target.copy(arm.contact).sub(arm.socket.getWorldPosition(offset).sub(arm.hand.getWorldPosition(end)));
      arm.upper.getWorldQuaternion(upper); arm.lower.getWorldQuaternion(lower);
      pole.set(index === 0 ? .7 : -.7, -.25, -.25).applyQuaternion(root.getWorldQuaternion(parent));
      const solution = solveTwoBone({ root: arm.upper.getWorldPosition(shoulder),
        middle: arm.lower.getWorldPosition(elbow), end: arm.hand.getWorldPosition(end) }, target, pole);
      arm.upper.quaternion.copy(arm.upper.parent!.getWorldQuaternion(parent).invert().multiply(solution.rootDelta.multiply(upper)));
      arm.lower.quaternion.copy(arm.lower.parent!.getWorldQuaternion(parent).invert().multiply(solution.middleDelta.multiply(lower)));
      arm.hand.quaternion.copy(arm.hand.parent!.getWorldQuaternion(parent).invert().multiply(arm.rotation));
    }
  };
  return (targets?: readonly Point3[]) => {
    if (!targets || arms.some(arm => !arm.upper?.parent || !arm.lower?.parent || !arm.hand?.parent || !arm.index || !arm.pinky)) return;
    root.updateMatrixWorld(true);
    arms.forEach((arm, index) => root.localToWorld(arm.contact.fromArray(targets[index]!)));
    axis.subVectors(arms[1]!.contact, arms[0]!.contact);
    const half = axis.length() / 2; if (half < .025) return; axis.normalize();
    centre.copy(arms[0]!.contact).add(arms[1]!.contact).multiplyScalar(.5);
    for (let pass = 0; pass < 3; pass++) {
      for (const [index, arm] of arms.entries()) {
        orient(arm, pass);
        arm.upper.getWorldPosition(shoulder); arm.lower.getWorldPosition(elbow); arm.hand.getWorldPosition(end);
        arm.radius = (shoulder.distanceTo(elbow) + elbow.distanceTo(end)) * .995;
        arm.centre.copy(arm.socket.getWorldPosition(offset)).sub(end).add(shoulder).addScaledVector(axis, index === 0 ? half : -half);
      }
      for (let projection = 0; projection < 6; projection++) for (const arm of arms) {
        point.subVectors(centre, arm.centre);
        if (point.length() > arm.radius) centre.copy(arm.centre).addScaledVector(point.normalize(), arm.radius);
      }
      arms.forEach((arm, index) => { arm.contact.copy(centre).addScaledVector(axis, index === 0 ? -half : half); solve(arm, index); });
      root.updateMatrixWorld(true);
    }
  };
};
