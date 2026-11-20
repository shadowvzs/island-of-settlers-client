import { type Object3D,Quaternion, Vector3 } from "three";

/** Keep a crouching knee toward the worker's front, independent of the arriving walk's bend plane. */
export const createGroundedKneePlacement = (root: Object3D) => {
  const hip = new Vector3(), knee = new Vector3(), ankle = new Vector3();
  const towardFoot = new Vector3(), forward = new Vector3(), desiredKnee = new Vector3();
  const from = new Vector3(), to = new Vector3();
  const world = new Quaternion(), parent = new Quaternion(), delta = new Quaternion();
  return (upper: Object3D, lower: Object3D, foot: Object3D, target: Vector3) => {
    if (!upper.parent || !lower.parent) return;
    root.updateMatrixWorld(true);
    upper.getWorldPosition(hip); lower.getWorldPosition(knee); foot.getWorldPosition(ankle);
    const thighLength = hip.distanceTo(knee), shinLength = knee.distanceTo(ankle);
    const distance = Math.max(1e-6, Math.min(hip.distanceTo(target), (thighLength + shinLength) * .9995));
    towardFoot.copy(target).sub(hip).normalize();
    forward.set(0, 0, 1).applyQuaternion(root.getWorldQuaternion(world));
    forward.addScaledVector(towardFoot, -forward.dot(towardFoot)).normalize();
    const along = (thighLength ** 2 - shinLength ** 2 + distance ** 2) / (2 * distance);
    const bend = Math.sqrt(Math.max(0, thighLength ** 2 - along ** 2));
    desiredKnee.copy(hip).addScaledVector(towardFoot, along).addScaledVector(forward, bend);
    from.copy(knee).sub(hip).normalize(); to.copy(desiredKnee).sub(hip).normalize();
    delta.setFromUnitVectors(from, to);
    upper.getWorldQuaternion(world).premultiply(delta);
    upper.quaternion.copy(upper.parent.getWorldQuaternion(parent).invert().multiply(world));
    root.updateMatrixWorld(true);
    lower.getWorldPosition(knee); foot.getWorldPosition(ankle);
    from.copy(ankle).sub(knee).normalize(); to.copy(target).sub(knee).normalize();
    delta.setFromUnitVectors(from, to);
    lower.getWorldQuaternion(world).premultiply(delta);
    lower.quaternion.copy(lower.parent.getWorldQuaternion(parent).invert().multiply(world));
    root.updateMatrixWorld(true);
  };
};
