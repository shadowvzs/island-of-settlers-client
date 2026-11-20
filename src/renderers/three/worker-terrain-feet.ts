import { type Object3D,Quaternion, Vector3 } from "three";

import type { WorkerFrame } from "../../render-common/workers/worker-unit";

export type WorkerGroundHeight = (x: number, z: number) => number;

const TERRAIN_LOCOMOTION = ["walk", "run", "carry_shoulder", "carry_back", "carry_overhead_boat"];

/** Leg-only terrain correction: preserve the animated stride, flight and upper-body contacts. */
export const createWorkerTerrainFeet = (root: Object3D, height: WorkerGroundHeight) => {
  const legs = ["Left", "Right"].map(side => ({
    upper: root.getObjectByName(`${side}UpLeg`),
    lower: root.getObjectByName(`${side}Leg`),
    foot: root.getObjectByName(`${side}Foot`)
  }));
  const available = legs.every(leg => leg.upper?.parent && leg.lower?.parent && leg.foot);
  const hip = new Vector3(), knee = new Vector3(), ankle = new Vector3();
  const target = new Vector3(), direction = new Vector3(), pole = new Vector3(), wantedKnee = new Vector3();
  const from = new Vector3(), to = new Vector3();
  const rotation = new Quaternion(), parent = new Quaternion(), delta = new Quaternion();
  const footRotation = new Quaternion();
  const solve = (upper: Object3D, lower: Object3D, foot: Object3D, offset: number) => {
    upper.getWorldPosition(hip); lower.getWorldPosition(knee); foot.getWorldPosition(ankle);
    foot.getWorldQuaternion(footRotation);
    target.copy(ankle); target.y += offset;
    const thighLength = hip.distanceTo(knee), shinLength = knee.distanceTo(ankle);
    direction.copy(target).sub(hip);
    const distance = Math.min(direction.length(), (thighLength + shinLength) * .9995);
    direction.normalize();
    // Keep the sampled knee bend plane; use forward only for a nearly straight leg.
    pole.copy(knee).sub(hip).addScaledVector(direction, -pole.dot(direction));
    if (pole.lengthSq() < 1e-8) {
      pole.set(0, 0, 1).applyQuaternion(root.getWorldQuaternion(rotation));
      pole.addScaledVector(direction, -pole.dot(direction));
    }
    pole.normalize();
    const along = (thighLength ** 2 - shinLength ** 2 + distance ** 2) / (2 * distance);
    const bend = Math.sqrt(Math.max(0, thighLength ** 2 - along ** 2));
    wantedKnee.copy(hip).addScaledVector(direction, along).addScaledVector(pole, bend);
    from.copy(knee).sub(hip).normalize(); to.copy(wantedKnee).sub(hip).normalize();
    delta.setFromUnitVectors(from, to);
    upper.getWorldQuaternion(rotation).premultiply(delta);
    upper.quaternion.copy(upper.parent!.getWorldQuaternion(parent).invert().multiply(rotation));
    upper.updateWorldMatrix(false, true);
    lower.getWorldPosition(knee); foot.getWorldPosition(ankle);
    target.copy(hip).addScaledVector(direction, distance);
    from.copy(ankle).sub(knee).normalize(); to.copy(target).sub(knee).normalize();
    delta.setFromUnitVectors(from, to);
    lower.getWorldQuaternion(rotation).premultiply(delta);
    lower.quaternion.copy(lower.parent!.getWorldQuaternion(parent).invert().multiply(rotation));
    lower.updateWorldMatrix(false, true);
    foot.quaternion.copy(foot.parent!.getWorldQuaternion(parent).invert().multiply(footRotation));
    foot.updateWorldMatrix(false, true);
  };
  return (frame: WorkerFrame) => {
    if (!available || !TERRAIN_LOCOMOTION.includes(frame.action)) return;
    if (frame.wareTransfer || frame.fall !== undefined || frame.lean || frame.combat?.attackProgress != null) return;
    const ground = height(frame.x, frame.z);
    // Decks, piers and raised building floors have their own support surface.
    if (!Number.isFinite(ground) || Math.abs(frame.y - ground) > .12) return;
    // Most roads are level: avoid a full skeleton traversal and IK there.
    const across = height(frame.x + .35, frame.z) - ground;
    const along = height(frame.x, frame.z + .35) - ground;
    if (Math.abs(across) < .0005 && Math.abs(along) < .0005) return;
    root.updateWorldMatrix(true, true);
    for (const leg of legs) {
      leg.foot!.getWorldPosition(ankle);
      const offset = height(ankle.x, ankle.z) - ground;
      if (!Number.isFinite(offset) || Math.abs(offset) < .001 || Math.abs(offset) > .18) continue;
      solve(leg.upper!, leg.lower!, leg.foot!, offset);
    }
  };
};
