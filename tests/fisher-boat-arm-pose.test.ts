import { Bone, Group, Quaternion, Vector3 } from "three";
import { expect, it } from "vitest";

import { createBoatArmApplicator } from "../src/renderers/three/worker-boat-elbow-clearance";

const rig = (yaw: number, scale: number) => {
  const root = new Group(); root.rotation.y = yaw; root.scale.setScalar(scale);
  const upper = new Bone(), lower = new Bone(), hand = new Bone(), socket = new Bone();
  upper.name = "LeftArm"; lower.name = "LeftForeArm"; hand.name = "LeftHand";
  upper.position.set(.1, .45, 0); lower.position.set(.2, 0, 0); hand.position.set(.17, 0, 0);
  hand.rotation.z = .05; socket.position.set(.05, -.01, .02);
  root.add(upper); upper.add(lower); lower.add(hand); hand.add(socket); root.updateMatrixWorld(true);
  return { root, upper, lower, hand, socket, solver: createBoatArmApplicator(root) };
};

it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2])("keeps the real socket on its target through relaxed-wrist blending at heading %s", yaw => {
  const { root, upper, lower, hand, socket, solver } = rig(yaw, 1.2);
  const at = (bone: Bone) => bone.getWorldPosition(new Vector3());
  const first = at(upper).distanceTo(at(lower)), second = at(lower).distanceTo(at(hand));
  const rest = lower.getWorldQuaternion(new Quaternion()).invert().multiply(hand.getWorldQuaternion(new Quaternion()));
  const rotation = root.getWorldQuaternion(new Quaternion());
  const goal = root.localToWorld(new Vector3(.24, .35, .1));
  const endpoint = root.localToWorld(new Vector3(.35, .36, .08));
  const pole = new Vector3(0, -1, 1).applyQuaternion(rotation);
  const orientation = rotation.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -.3));
  const axis = new Vector3(0, 0, 1).applyQuaternion(rotation);
  for (const weight of [0, .25, .5, .75, 1]) {
    solver.relaxSocket(upper, lower, hand, socket, goal, pole, endpoint, orientation, axis, new Vector3(1, 0, 0), weight);
    expect(at(socket).distanceTo(goal)).toBeLessThan(1e-6);
    expect(at(upper).distanceTo(at(lower))).toBeCloseTo(first, 8);
    expect(at(lower).distanceTo(at(hand))).toBeCloseTo(second, 8);
    if (weight === 0) expect(lower.getWorldQuaternion(new Quaternion()).invert()
      .multiply(hand.getWorldQuaternion(new Quaternion())).angleTo(rest)).toBeLessThan(1e-6);
  }
});

it("keeps the wrist transition continuous while retaining the socket contact", () => {
  const { root, upper, lower, hand, socket, solver } = rig(.7, .9);
  const endpoint = root.localToWorld(new Vector3(.3, .34, .1));
  const rotation = root.getWorldQuaternion(new Quaternion());
  const pole = new Vector3(0, -1, 1).applyQuaternion(rotation), axis = new Vector3(0, 0, 1).applyQuaternion(rotation);
  let previous: Quaternion | undefined;
  for (let frame = 0; frame <= 100; frame++) {
    solver.relaxSocket(upper, lower, hand, socket, endpoint, pole, endpoint, rotation, axis,
      new Vector3(1, 0, 0), frame / 100);
    const current = hand.getWorldQuaternion(new Quaternion());
    if (previous) expect(current.angleTo(previous)).toBeLessThan(.3);
    expect(socket.getWorldPosition(new Vector3()).distanceTo(endpoint)).toBeLessThan(1e-6);
    previous = current;
  }
});
