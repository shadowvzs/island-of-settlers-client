import { Bone, Group, Vector3 } from "three";
import { expect, it } from "vitest";

import { createGroundedKneePlacement } from "../src/renderers/three/worker-grounded-knees";

it("keeps planted ankles and bends knees forward from either incoming gait plane in four headings", () => {
  for (let turn = 0; turn < 4; turn++) for (const incomingBend of [-1, 1]) {
    const root = new Group(), upper = new Bone(), lower = new Bone(), foot = new Bone();
    root.position.set(2, 0, 3); root.rotation.y = turn * Math.PI / 2;
    root.add(upper); upper.add(lower); lower.add(foot);
    upper.position.y = .9; lower.position.y = -.4; foot.position.y = -.4;
    upper.rotation.x = -.2 * incomingBend; lower.rotation.x = .5 * incomingBend;
    root.updateMatrixWorld(true);
    const target = root.localToWorld(new Vector3(0, .16, .12));
    createGroundedKneePlacement(root)(upper, lower, foot, target);
    expect(foot.getWorldPosition(new Vector3()).distanceTo(target)).toBeLessThan(1e-8);
    const knee = root.worldToLocal(lower.getWorldPosition(new Vector3()));
    expect(knee.z).toBeGreaterThan(.05);
    expect(upper.position.y).toBe(.9);
    expect(lower.position.y).toBe(-.4);
    expect(foot.position.y).toBe(-.4);
  }
});
