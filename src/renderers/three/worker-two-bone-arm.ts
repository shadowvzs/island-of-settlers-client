import { solveTwoBone } from "@workers/retarget/two-bone-ik";
import { type Object3D, Quaternion, Vector3 } from "three";

/** Consumer application of the canonical worker solver; scratch storage belongs to this rig. */
export const createTwoBoneArmApplicator = (root: Object3D) => {
  const shoulder = new Vector3(), elbow = new Vector3(), end = new Vector3();
  const upperWorld = new Quaternion(), lowerWorld = new Quaternion(), parent = new Quaternion();
  return (upper: Object3D, lower: Object3D, hand: Object3D, target: Vector3, pole: Vector3) => {
    if (!upper.parent || !lower.parent) return;
    upper.getWorldQuaternion(upperWorld); lower.getWorldQuaternion(lowerWorld);
    const solution = solveTwoBone({ root: upper.getWorldPosition(shoulder),
      middle: lower.getWorldPosition(elbow), end: hand.getWorldPosition(end) }, target, pole);
    upper.quaternion.copy(upper.parent.getWorldQuaternion(parent).invert()
      .multiply(solution.rootDelta.multiply(upperWorld)));
    root.updateMatrixWorld(true);
    lower.quaternion.copy(lower.parent.getWorldQuaternion(parent).invert()
      .multiply(solution.middleDelta.multiply(lowerWorld)));
  };
};
