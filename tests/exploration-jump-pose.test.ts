import { Bone, Group } from "three";
import { expect, it } from "vitest";

import { createExplorationJumpPose } from "../src/renderers/three/exploration/exploration-jump-pose";

it("poses only the temporary rig and restores its sampled bone transforms without accumulation", () => {
  const root = new Group(); root.scale.setScalar(.8);
  for (const name of ["Hips", "Spine", "LeftUpLeg", "RightUpLeg", "LeftLeg", "RightLeg"]) {
    const bone = new Bone(); bone.name = name; root.add(bone);
  }
  const hips = root.getObjectByName("Hips")!; hips.position.y = .8;
  const leg = root.getObjectByName("LeftLeg")!, initial = leg.quaternion.clone();
  const pose = createExplorationJumpPose(root);
  for (let cycle = 0; cycle < 100; cycle++) {
    pose.reset(); pose.apply({ crouch: 1, tuck: 0 });
    expect(hips.position.y).toBeCloseTo(.8 - .045 / .8);
    expect(leg.quaternion.angleTo(initial)).toBeCloseTo(.9);
  }
  pose.reset(); pose.apply(undefined);
  expect(hips.position.y).toBe(.8); expect(leg.quaternion.equals(initial)).toBe(true);
});
