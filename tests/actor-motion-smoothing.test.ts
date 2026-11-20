import { describe, expect, it } from "vitest";

import { createMotionSmoother } from "../src/app/settlement/actor-motion-smoothing";

const pose = (x: number, yaw = 0) => ({ x, y: 0, yaw, z: 0 });

describe("actor motion smoothing", () => {
  it("keeps a rider's steered facing despite alternating sideways avoidance steps", () => {
    const smoother = createMotionSmoother(), yaw = Math.PI / 2;
    for (let tick = 0; tick < 30; tick++) {
      const target = { x: tick * .06, y: 0, z: tick % 2 ? .025 : -.025, yaw };
      expect(smoother.smooth(1, target, .5, .05, false, true).yaw).toBeCloseTo(yaw);
    }
    expect(smoother.smooth(1, { x: 1.8, y: 0, z: 0, yaw: 0 }, .5, .05, false, true).yaw)
      .toBeLessThan(yaw);
  });
  it("holds tiny reversing horse corrections briefly but responds immediately to a real turn", () => {
    const smoother = createMotionSmoother();
    smoother.smooth(1, pose(0), 1, .02, false, true);
    const first = smoother.smooth(1, pose(0, .15), 1, .02, false, true).yaw;
    expect(first).toBeGreaterThan(0);
    const held = smoother.smooth(1, pose(0, -.1), 1, .02, false, true).yaw;
    expect(held).toBe(first);
    expect(smoother.smooth(1, pose(0, -1), 1, .02, false, true).yaw).toBeLessThan(held);
  });
  it("draws actors between their last two simulation ticks", () => {
    const smoother = createMotionSmoother();
    smoother.smooth(1, pose(0), 1, .016);
    expect(smoother.smooth(1, pose(.1), 0, .016).x).toBeCloseTo(0);
    expect(smoother.smooth(1, pose(.1), .5, .016).x).toBeCloseTo(.05);
    expect(smoother.smooth(1, pose(.1), 1, .016).x).toBeCloseTo(.1);
    expect(smoother.smooth(1, pose(.2), .25, .016).x).toBeCloseTo(.125);
  });

  it("snaps a placed actor and turns a facing at a limited rate", () => {
    const smoother = createMotionSmoother();
    smoother.smooth(1, pose(0), 1, .016);
    expect(smoother.smooth(1, pose(5), .1, .016).x).toBe(5);
    const turned = smoother.smooth(1, pose(5, Math.PI / 2), 1, .05).yaw;
    expect(turned).toBeGreaterThan(0);
    expect(turned).toBeLessThan(Math.PI / 2);
    for (let frame = 0; frame < 10; frame++) smoother.smooth(1, pose(5, Math.PI / 2), 1, .05);
    expect(smoother.smooth(1, pose(5, Math.PI / 2), 1, .05).yaw).toBeCloseTo(Math.PI / 2);
  });

  it("keeps facing the way walked on stopping while the simulation's own facing still lags", () => {
    const smoother = createMotionSmoother();
    const at = (x: number, z: number, yaw: number) => ({ x, y: 0, yaw, z });
    smoother.smooth(1, at(0, 0, Math.PI / 2), 1, .05);
    smoother.smooth(1, at(.07, 0, Math.PI / 2), .1, .05);
    // A sharp turn: the walk heads north (+z), the simulation's steered facing only starts to turn.
    smoother.smooth(1, at(.07, .07, Math.PI / 2 - .3), .1, .05);
    let yaw = 0;
    for (let frame = 0; frame < 20; frame++) yaw = smoother.smooth(1, at(.07, .07, Math.PI / 2 - .3), .1, .05).yaw;
    expect(yaw).toBeCloseTo(0);
    // Once the simulation sets a facing of its own (an enemy, a work target), the figure turns to it.
    for (let frame = 0; frame < 20; frame++) yaw = smoother.smooth(1, at(.07, .07, Math.PI), .1, .05).yaw;
    expect(Math.abs(yaw)).toBeCloseTo(Math.PI);
  });

  it("keeps a stopped actor still instead of replaying its last step every tick", () => {
    const smoother = createMotionSmoother();
    smoother.smooth(1, pose(0), 1, .016);
    smoother.smooth(1, pose(.1), .2, .016);
    smoother.smooth(1, pose(.1), .9, .016);
    // The next tick arrives (fraction wraps) but the actor did not move.
    expect(smoother.smooth(1, pose(.1), .1, .016).x).toBeCloseTo(.1);
    expect(smoother.smooth(1, pose(.1), .6, .016).x).toBeCloseTo(.1);
  });

  it("turns to a work target facing set in the same tick as the arrival step", () => {
    const smoother = createMotionSmoother();
    const at = (x: number, z: number, yaw: number) => ({ x, y: 0, yaw, z });
    smoother.smooth(1, at(0, 0, 0), 1, .05);
    // The last step walks north (+z) and the Fisher's cast facing (east) is set in that same tick.
    smoother.smooth(1, at(0, .07, Math.PI / 2), .1, .05);
    let yaw = 0;
    for (let frame = 0; frame < 20; frame++) yaw = smoother.smooth(1, at(0, .07, Math.PI / 2), .1, .05, true).yaw;
    expect(yaw).toBeCloseTo(Math.PI / 2);
  });
});
