import { Group, Quaternion, Vector3 } from "three";
import { expect, it } from "vitest";

import { orientWorkingHammer } from "../src/renderers/three/worker-hammer-strike";

it("turns the head face into the swing plane while preserving the shaft, grip and size", () => {
  const hammer = new Group();
  hammer.position.set(-.17, .65, .22);
  hammer.scale.setScalar(.9);
  hammer.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), 1.1);
  const position = hammer.position.clone(), scale = hammer.scale.clone();
  const shaft = new Vector3(0, 1, 0).applyQuaternion(hammer.quaternion);
  const face = new Vector3(1, 0, 0).applyQuaternion(hammer.quaternion);
  const strike = new Vector3(0, -Math.sin(1.1), Math.cos(1.1));
  expect(Math.abs(face.dot(strike))).toBeLessThan(1e-10);
  orientWorkingHammer(hammer);
  expect(new Vector3(0, 1, 0).applyQuaternion(hammer.quaternion).distanceTo(shaft)).toBeLessThan(1e-10);
  expect(new Vector3(1, 0, 0).applyQuaternion(hammer.quaternion).dot(strike)).toBeCloseTo(1, 10);
  expect(hammer.position).toEqual(position);
  expect(hammer.scale).toEqual(scale);
});

it.each([0, Math.PI / 2, Math.PI, Math.PI * 1.5])("the correction follows placed heading %s", heading => {
  const hammer = new Group();
  hammer.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), heading)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 1.1));
  const strike = new Vector3(0, -Math.sin(1.1), Math.cos(1.1))
    .applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), heading));
  orientWorkingHammer(hammer);
  expect(new Vector3(1, 0, 0).applyQuaternion(hammer.quaternion).dot(strike)).toBeCloseTo(1, 10);
});
