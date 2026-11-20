import { expect, it } from "vitest";

import { advanceExplorationJump, beginExplorationJump, EXPLORATION_JUMP_HEIGHT, explorationJumpPose } from "../src/app/exploration/jump";

it("takes off, reaches the modest hop height and lands once on the actual floor", () => {
  let jump: ReturnType<typeof advanceExplorationJump> = beginExplorationJump(3), maximum = 3;
  const phases = new Set<string>();
  for (let frame = 0; frame < 200 && jump; frame++) {
    phases.add(jump.phase); maximum = Math.max(maximum, jump.feetY);
    jump = advanceExplorationJump(jump, 3, Infinity, 1.0625, .01);
  }
  expect([...phases]).toEqual(["takeoff", "air", "landing"]);
  expect(maximum - 3).toBeCloseTo(EXPLORATION_JUMP_HEIGHT, 3);
  expect(jump).toBeNull();
});

it("slows ascent continuously near the apex and accelerates the fall rather than moving linearly", () => {
  let jump = advanceExplorationJump(beginExplorationJump(0), 0, Infinity, 1.0625, .08)!;
  const rise: number[] = [], fall: number[] = [];
  let smallestStep = Infinity;
  while (jump.phase === "air") {
    const before = jump;
    const next = advanceExplorationJump(before, 0, Infinity, 1.0625, .01)!;
    if (next.phase !== "air") break;
    const distance = next.feetY - before.feetY;
    smallestStep = Math.min(smallestStep, Math.abs(distance));
    if (before.velocity > .5 && next.velocity > .5) rise.push(distance);
    if (before.velocity < -.5 && next.velocity < -.5) fall.push(-distance);
    jump = next;
  }
  expect(rise.length).toBeGreaterThan(20); expect(fall.length).toBeGreaterThan(20);
  expect(rise.every((value, index) => index === 0 || value < rise[index - 1]!)).toBe(true);
  expect(fall.every((value, index) => index === 0 || value > fall[index - 1]!)).toBe(true);
  // At10ms sampling the closest interval need not land exactly on the mathematical apex.
  expect(smallestStep).toBeLessThan(.0005);
});

it("stops upward velocity at a low underside without crossing it or the floor", () => {
  let jump = beginExplorationJump(2), contacted = false;
  for (let frame = 0; frame < 80; frame++) {
    const next = advanceExplorationJump(jump, 2, 3.2, 1.0625, .01);
    if (!next) break;
    expect(next.feetY).toBeGreaterThanOrEqual(2);
    expect(next.feetY + 1.0625).toBeLessThanOrEqual(3.2 - .015 + 1e-9);
    if (next.phase === "air" && next.velocity === 0) contacted = true;
    jump = next;
  }
  expect(contacted).toBe(true);
});

it("lands on a raised stair and keeps a lower slope below the airborne body", () => {
  let jump: ReturnType<typeof advanceExplorationJump> = beginExplorationJump(0);
  for (let frame = 0; frame < 20; frame++) jump = advanceExplorationJump(jump!, 0, Infinity, 1.0625, .01);
  const airborne = jump!.feetY;
  jump = advanceExplorationJump(jump!, -.3, Infinity, 1.0625, .01);
  expect(jump!.feetY).toBeGreaterThan(airborne);
  jump = advanceExplorationJump(jump!, .5, Infinity, 1.0625, .01);
  expect(jump!.feetY).toBe(.5); expect(jump!.phase).toBe("landing");
});

it("freezes on a paused delta and bounds a background gap instead of teleporting", () => {
  const jump = beginExplorationJump(0);
  expect(advanceExplorationJump(jump, 0, Infinity, 1.0625, 0)).toBe(jump);
  expect(advanceExplorationJump(jump, 0, Infinity, 1.0625, -1)).toBe(jump);
  expect(advanceExplorationJump(jump, 0, Infinity, 1.0625, 30))
    .toEqual(advanceExplorationJump(jump, 0, Infinity, 1.0625, .25));
  expect(explorationJumpPose({ ...jump, elapsed: .04 }).crouch).toBeGreaterThan(.5);
});
