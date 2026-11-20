import { describe, expect, it } from "vitest";

import { createShipProgress } from "../src/shared/settlement/settlement-ship-progress";

describe("ship net progress", () => {
  it("keeps slow travel and an in-place harbour turn out of jam recovery", () => {
    const progresses = createShipProgress(6);
    const travel = { x: 0, yaw: 0, z: 0 }, turn = { x: 0, yaw: 0, z: 0 };
    for (let tick = 0; tick < 600; tick++) {
      travel.z += .02;
      if (tick < 200) turn.yaw += .01;
      else turn.z += .02;
      expect(progresses(travel, .05)).toBe(true);
      expect(progresses(turn, .05)).toBe(true);
    }
  });

  it("detects repeated small forward/backward manoeuvres and recovers when the hull escapes", () => {
    const progresses = createShipProgress(6), ship = { x: 0, yaw: 0, z: 0 };
    let moving = true;
    for (let tick = 0; tick < 200; tick++) {
      ship.x = Math.sin(tick * .1) * .1;
      ship.yaw = Math.sin(tick * .1) * .05;
      moving = progresses(ship, .05);
      if (tick < 100) expect(moving).toBe(true);
    }
    expect(moving).toBe(false);
    ship.z = 1.1;
    expect(progresses(ship, .05)).toBe(true);
  });

  it("does not let repeated large opposite swings conceal a hull that never leaves its spot", () => {
    const progresses = createShipProgress(6), ship = { x: 0, yaw: 0, z: 0 };
    let moving = true;
    for (let tick = 0; tick < 1200; tick++) {
      ship.x = Math.sin(tick * .1) * .1;
      ship.yaw = Math.sin(tick * .1) * .7;
      moving = progresses(ship, .05);
    }
    expect(moving).toBe(false);
    ship.z = 1.1;
    expect(progresses(ship, .05)).toBe(true);
  });

  it("detects a wide loop that never approaches the unchanged open-water waypoint", () => {
    const progresses = createShipProgress(6), ship = { x: 0, yaw: 0, z: 0 }, goal = { x: 10, z: 0 };
    let moving = true;
    for (let tick = 0; tick < 1200; tick++) {
      ship.x = Math.sin(tick * .1) * 2;
      ship.yaw = Math.sin(tick * .1) * .7;
      moving = progresses(ship, .05, goal);
    }
    expect(moving).toBe(false);
    ship.x = 5;
    expect(progresses(ship, .05, goal)).toBe(true);
  });
});
