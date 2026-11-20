import { type Object3D,Quaternion, Vector3 } from "three";
/** Allocation-free analytic solve; the current bend plane preserves the rig's knee direction. */
const createLegSolver = () => {
  const reach = new Vector3(), thigh = new Vector3(), shin = new Vector3();
  const target = new Vector3(), axis = new Vector3(), swingAxis = new Vector3();
  const rootDelta = new Quaternion(), middleDelta = new Quaternion();
  const bendRoot = new Quaternion(), bendMiddle = new Quaternion(), swing = new Quaternion();
  const result = { rootDelta, middleDelta };
  const acos = (value: number) => Math.acos(Math.max(-1, Math.min(1, value)));
  const angle = (a: Vector3, b: Vector3) => acos(a.dot(b) / Math.max(1e-12, a.length() * b.length()));
  return (a: Vector3, b: Vector3, c: Vector3, goal: Vector3, pole: Vector3) => {
    reach.copy(c).sub(a); thigh.copy(b).sub(a); shin.copy(c).sub(b); target.copy(goal).sub(a);
    const upper = thigh.length(), lower = shin.length();
    const distance = Math.max(1e-6, Math.min(target.length(), (upper + lower) * .9995));
    axis.copy(reach).cross(thigh);
    if (axis.lengthSq() < 1e-12) axis.copy(reach).cross(pole);
    axis.normalize();
    const rootAngle = angle(reach, thigh), middleAngle = Math.PI - angle(thigh, shin);
    const wantedRoot = acos((upper * upper + distance * distance - lower * lower) / (2 * upper * distance));
    const wantedMiddle = acos((upper * upper + lower * lower - distance * distance) / (2 * upper * lower));
    bendRoot.setFromAxisAngle(axis, wantedRoot - rootAngle);
    bendMiddle.setFromAxisAngle(axis, wantedMiddle - middleAngle);
    swingAxis.copy(reach).cross(target); swing.identity();
    if (swingAxis.lengthSq() > 1e-12) swing.setFromAxisAngle(swingAxis.normalize(), angle(reach, target));
    rootDelta.copy(swing).multiply(bendRoot); middleDelta.copy(rootDelta).multiply(bendMiddle);
    return result;
  };
};

/** Correct the animation to the body's own leg proportions, without moving its footprints. */
export const createWorkerStance = (root: Object3D) => {
  const hips = root.getObjectByName("Hips");
  const legs = ["Left", "Right"].map((side) => ({
    thigh: root.getObjectByName(`${side}UpLeg`),
    knee: root.getObjectByName(`${side}Leg`),
    foot: root.getObjectByName(`${side}Foot`),
    target: new Vector3(), rotation: new Quaternion(),
    a: new Vector3(), b: new Vector3(), c: new Vector3(), lift: 0
  }));
  const up = new Vector3(0, 1, 0), pole = new Vector3(), q = new Quaternion();
  const position = new Vector3(), parentRotation = new Quaternion(), compensation = new Quaternion();
  const solve = createLegSolver();
  if (!hips || legs.some((leg) => !leg.thigh || !leg.knee || !leg.foot)) return { update: (_blend: number) => 0 };
  const update = (blend: number) => {
    root.updateWorldMatrix(true, true);
    const bend = (20 + 16 * Math.max(0, Math.min(1, blend))) * Math.PI / 180;
    let lift = Infinity;
    for (const leg of legs) {
      leg.thigh!.getWorldPosition(leg.a); leg.knee!.getWorldPosition(leg.b);
      leg.foot!.getWorldPosition(leg.target); leg.foot!.getWorldQuaternion(leg.rotation);
      const upper = leg.a.distanceTo(leg.b), lower = leg.b.distanceTo(leg.target);
      const horizontalSq = (leg.a.x - leg.target.x) ** 2 + (leg.a.z - leg.target.z) ** 2;
      const desiredReachSq = upper ** 2 + lower ** 2 + 2 * upper * lower * Math.cos(bend);
      const needed = Math.sqrt(Math.max(0, desiredReachSq - horizontalSq)) - (leg.a.y - leg.target.y);
      leg.lift = needed;
    }
    // Near a support change both feet share the pelvis, rather than switching its height
    // instantly when one foot becomes a fraction lower than the other.
    const left = legs[0]!, right = legs[1]!;
    const supportWidth = .08;
    const support = Math.max(0, Math.min(1, .5 + (right.target.y - left.target.y) / supportWidth));
    const weight = support * support * (3 - 2 * support);
    lift = left.lift * weight + right.lift * (1 - weight);
    // Both legs must still reach their existing targets; preserve run flight rather than forcing contact.
    for (const leg of legs) {
      const length = leg.a.distanceTo(leg.b) + leg.b.distanceTo(leg.target);
      const horizontalSq = (leg.a.x - leg.target.x) ** 2 + (leg.a.z - leg.target.z) ** 2;
      lift = Math.min(lift, Math.sqrt(Math.max(0, (length * .995) ** 2 - horizontalSq)) - (leg.a.y - leg.target.y));
    }
    lift = Math.max(0, Math.min(.075, lift));
    if (lift < 1e-5) return 0;
    hips.getWorldPosition(position).addScaledVector(up, lift);
    hips.parent!.worldToLocal(position); hips.position.copy(position);
    root.getWorldQuaternion(q); pole.set(0, 0, 1).applyQuaternion(q);
    // Every world query below refreshes its own ancestor chain (getWorldPosition/-Quaternion), so the
    // solve reads exactly what whole-body updates between the steps gave; one update leaves the body
    // in the same final state for the later pose layers.
    for (const leg of legs) {
      leg.thigh!.getWorldPosition(leg.a); leg.knee!.getWorldPosition(leg.b); leg.foot!.getWorldPosition(leg.c);
      const result = solve(leg.a, leg.b, leg.c, leg.target, pole);
      leg.thigh!.getWorldQuaternion(q).premultiply(result.rootDelta);
      leg.thigh!.parent!.getWorldQuaternion(parentRotation).invert();
      leg.thigh!.quaternion.copy(parentRotation.multiply(q));
      compensation.copy(result.rootDelta).invert().premultiply(result.middleDelta);
      leg.knee!.getWorldQuaternion(q).premultiply(compensation);
      leg.knee!.parent!.getWorldQuaternion(parentRotation).invert();
      leg.knee!.quaternion.copy(parentRotation.multiply(q));
      leg.foot!.parent!.getWorldQuaternion(parentRotation).invert();
      leg.foot!.quaternion.copy(parentRotation.multiply(leg.rotation));
    }
    root.updateWorldMatrix(true, true);
    return lift;
  };
  return { update };
};
