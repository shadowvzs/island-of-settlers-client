import { Bone, Group, Quaternion, Vector3 } from "three";
import { expect, it } from "vitest";

import { createWorkerPoseTransition } from "../src/renderers/three/worker-pose-transition";
it("eases incoming loaded legs into the gesture without changing the sampled endpoint", () => {
  const root = new Group(), bone = new Bone(); root.add(bone);
  const incoming = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), .8);
  bone.position.y = .48; bone.quaternion.copy(incoming);
  const transition = createWorkerPoseTransition(root); transition.capture();
  for (const [progress, height] of [[0, .48], [.075, .39], [.15, .3], [1, .3]]) {
    bone.position.y = .3; bone.quaternion.identity(); transition.ease(progress!);
    expect(bone.position.y).toBeCloseTo(height!);
    if (progress === 0) expect(bone.quaternion.angleTo(incoming)).toBeLessThan(1e-7);
    if (progress! >= .15) expect(bone.quaternion.angleTo(new Quaternion())).toBeLessThan(1e-7);
  }
  expect(root.position.y).toBe(0); expect(root.scale.toArray()).toEqual([1, 1, 1]);
});
