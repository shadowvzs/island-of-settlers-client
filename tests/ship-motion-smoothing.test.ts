import { expect, it } from "vitest";

import { TICK_SECONDS } from "../../island-of-settlers-shared/src/time/constants";
import { createMotionSmoother } from "../src/app/settlement/actor-motion-smoothing";
import { smoothShipLikeFrames } from "../src/app/settlement/ship-motion-smoothing";

const frame = (x: number, yaw = 0) => ({ id: 4, kind: "ship" as const, x, y: .3, yaw, z: 0 });

it("interpolates ship poses between two simulation ticks", () => {
  const smoother = createMotionSmoother();
  smoothShipLikeFrames(smoother, [frame(1)], 0, TICK_SECONDS);
  const middle = smoothShipLikeFrames(smoother, [frame(1.075)], .5, TICK_SECONDS);
  expect(middle[0]!.x).toBeCloseTo(1.0375, 8);
  const end = smoothShipLikeFrames(smoother, [frame(1.075)], 1, TICK_SECONDS);
  expect(end[0]!.x).toBeCloseTo(1.075, 8);
});

it("snaps a teleported ship and follows a small yaw change smoothly", () => {
  const smoother = createMotionSmoother();
  smoothShipLikeFrames(smoother, [frame(0)], 0, TICK_SECONDS);
  const jumped = smoothShipLikeFrames(smoother, [frame(5, .04)], .25, TICK_SECONDS);
  expect(jumped[0]!.x).toBe(5);
  expect(jumped[0]!.yaw).toBeCloseTo(.04, 8);
  const turned = smoothShipLikeFrames(smoother, [frame(5, .08)], .25, TICK_SECONDS);
  expect(turned[0]!.yaw).toBeGreaterThan(.04);
  expect(turned[0]!.yaw).toBeLessThan(.08);
});
