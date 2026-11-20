import { solveTwoBone } from "@workers/retarget/two-bone-ik";
import { Group, Object3D, Quaternion, Vector3 } from "three";
import { expect, it } from "vitest";

import { createTwoBoneArmApplicator } from "../src/renderers/three/worker-two-bone-arm";

const rig = (heading: number, scale: number) => {
  const root = new Group(), upper = new Object3D(), lower = new Object3D(), hand = new Object3D();
  root.position.set(4, .7, -2); root.rotation.set(.12, heading, -.05); root.scale.setScalar(scale);
  upper.position.set(.15, .9, 0); lower.position.set(.05, -.3, .03); hand.position.set(-.03, -.28, .04);
  upper.rotation.set(.2, -.3, .1); lower.rotation.set(.1, .1, -.4);
  root.add(upper); upper.add(lower); lower.add(hand); root.updateMatrixWorld(true);
  return { hand, lower, root, upper };
};

/** Original consumer sequence, independent of the extracted applicator's scratch objects. */
const reference = (joints: ReturnType<typeof rig>, target: Vector3, pole: Vector3) => {
  const { hand, lower, root, upper } = joints;
  const upperWorld = upper.getWorldQuaternion(new Quaternion());
  const lowerWorld = lower.getWorldQuaternion(new Quaternion());
  const solution = solveTwoBone({ root: upper.getWorldPosition(new Vector3()),
    middle: lower.getWorldPosition(new Vector3()), end: hand.getWorldPosition(new Vector3()) }, target, pole);
  upper.quaternion.copy(upper.parent!.getWorldQuaternion(new Quaternion()).invert()
    .multiply(solution.rootDelta.multiply(upperWorld)));
  root.updateMatrixWorld(true);
  lower.quaternion.copy(lower.parent!.getWorldQuaternion(new Quaternion()).invert()
    .multiply(solution.middleDelta.multiply(lowerWorld)));
};

it("preserves the original two-bone application across transformed, reachable and stretched poses", () => {
  for (const heading of [-2, 0, .7]) for (const scale of [.6, 1, 1.4]) {
    const actual = rig(heading, scale), expected = rig(heading, scale);
    const apply = createTwoBoneArmApplicator(actual.root);
    for (const offset of [.1, .35, 3, -.2]) {
      const target = new Vector3(offset, .6, .3).applyMatrix4(actual.root.matrixWorld);
      const pole = new Vector3(-.5, -.8, -.3).applyQuaternion(actual.root.quaternion);
      for (let pass = 0; pass < 8; pass++) {
        reference(expected, target, pole); apply(actual.upper, actual.lower, actual.hand, target, pole);
        actual.root.updateMatrixWorld(true); expected.root.updateMatrixWorld(true);
        for (const name of ["upper", "lower", "hand"] as const) {
          expect(actual[name].matrixWorld.elements).toEqual(expected[name].matrixWorld.elements);
        }
      }
    }
  }
});

it("keeps detached incomplete chains unchanged", () => {
  const { hand, lower, root, upper } = rig(0, 1);
  upper.removeFromParent();
  const before = lower.quaternion.clone();
  createTwoBoneArmApplicator(root)(upper, lower, hand, new Vector3(), new Vector3(0, 0, 1));
  expect(lower.quaternion.equals(before)).toBe(true);
});
