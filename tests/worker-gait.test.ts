import {
  RUN_DURATION,
  RUN_GROUND_SPEED,
  WALK_DURATION
} from "@workers/worker-locomotion";
import { describe, expect, it } from "vitest";

import { WORKER_SCALE } from "../src/render-common/workers/worker-dimensions";
import {
  advanceGaitPhase,
  easeGaitSpeed,
  isRunTrip,
  locomotionAction,
  locomotionClipTime,
  routeDistance,
  RUN_SPEED,
  RUN_TRIP_DISTANCE,
  runBlend,
  SLOW_DOWN_DISTANCE,
  targetGaitSpeed,
  WALK_SPEED
} from "../src/render-common/workers/worker-gait";

/** A straight trip with the unit's speed rule: per-step speed and the distance still to go. */
const simulateTrip = (distance: number) => {
  const steps: { remaining: number; speed: number }[] = [];
  const runTrip = isRunTrip(distance);
  let remaining = distance;
  let speed = WALK_SPEED;
  while (remaining > 0) {
    speed = easeGaitSpeed(speed, targetGaitSpeed(runTrip, remaining), 1 / 60);
    remaining -= speed / 60;
    steps.push({ remaining, speed });
  }
  return steps;
};

describe("worker walk / run decision", () => {
  it("runs only on trips longer than the run distance", () => {
    expect(isRunTrip(RUN_TRIP_DISTANCE - 0.5)).toBe(false);
    expect(isRunTrip(RUN_TRIP_DISTANCE)).toBe(false);
    expect(isRunTrip(RUN_TRIP_DISTANCE + 0.5)).toBe(true);
  });
  it("aims at a walk for short trips and for the end of long ones", () => {
    expect(targetGaitSpeed(false, 10)).toBe(WALK_SPEED);
    expect(targetGaitSpeed(true, 10)).toBe(RUN_SPEED);
    expect(targetGaitSpeed(true, SLOW_DOWN_DISTANCE - 0.1)).toBe(WALK_SPEED);
  });
  it("measures the route through its waypoints and on to a capped route's target", () => {
    const path = new Float32Array([3, 0, 3, 4]);
    expect(routeDistance(0, 0, path, 0, 2, { x: 3, z: 4 })).toBeCloseTo(7);
    expect(routeDistance(0, 0, path, 1, 2, { x: 3, z: 4 })).toBeCloseTo(5);
    expect(routeDistance(0, 0, path, 0, 1, { x: 3, z: 4 })).toBeCloseTo(7);
  });
});

describe("worker speed easing", () => {
  it("accelerates and decelerates gradually without overshooting", () => {
    const faster = easeGaitSpeed(WALK_SPEED, RUN_SPEED, 0.1);
    expect(faster).toBeGreaterThan(WALK_SPEED);
    expect(faster).toBeLessThan(RUN_SPEED);
    expect(easeGaitSpeed(faster, RUN_SPEED, 10)).toBe(RUN_SPEED);
    const slower = easeGaitSpeed(RUN_SPEED, WALK_SPEED, 0.1);
    expect(slower).toBeLessThan(RUN_SPEED);
    expect(easeGaitSpeed(slower, WALK_SPEED, 10)).toBe(WALK_SPEED);
  });
  it("walks a short trip the whole way", () => {
    expect(simulateTrip(8).every(({ speed }) => speed === WALK_SPEED)).toBe(true);
  });
  it("runs a long trip and walks its last two cells", () => {
    const steps = simulateTrip(30);
    expect(Math.max(...steps.map(({ speed }) => speed))).toBe(RUN_SPEED);
    const arriving = steps.filter(({ remaining }) => remaining < 2);
    expect(arriving.every(({ speed }) => speed === WALK_SPEED)).toBe(true);
    expect(steps.at(-1)!.speed).toBe(WALK_SPEED);
  });
});

describe("worker gait animation", () => {
  it("crossfades from walk to run with the speed", () => {
    expect(runBlend(WALK_SPEED)).toBe(0);
    expect(runBlend(RUN_SPEED)).toBe(1);
    expect(runBlend((WALK_SPEED + RUN_SPEED) / 2)).toBeCloseTo(0.5);
    expect(locomotionAction(0.4)).toBe("walk");
    expect(locomotionAction(0.6)).toBe("run");
  });
  it("plays the run at the ground speed so planted feet do not slide", () => {
    const moved = 0.3 * RUN_GROUND_SPEED * RUN_DURATION * WORKER_SCALE;
    const phase = advanceGaitPhase(0, moved, 1);
    expect(phase).toBeCloseTo(0.3);
    const clipTravel = locomotionClipTime("run", phase) * RUN_GROUND_SPEED * WORKER_SCALE;
    expect(clipTravel).toBeCloseTo(moved);
  });
  it("walks at 1x playback with a natural cadence, stepping slower than the run", () => {
    const walkCyclesPerSecond = advanceGaitPhase(0, WALK_SPEED / 2, 0) * 2;
    expect(locomotionClipTime("walk", walkCyclesPerSecond)).toBeCloseTo(1);
    const walkSteps = 2 * walkCyclesPerSecond;
    expect(walkSteps).toBeGreaterThanOrEqual(1.6);
    expect(walkSteps).toBeLessThanOrEqual(2.2);
    const runSteps = 2 * advanceGaitPhase(0, RUN_SPEED / 2, 1) * 2;
    expect(runSteps).toBeGreaterThan(walkSteps);
    expect(WALK_SPEED).toBeLessThan(RUN_SPEED / 2);
  });
  it("keeps the phase when switching between walk and run", () => {
    const phase = advanceGaitPhase(0.9, 0.3, 0.5);
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(1);
    expect(locomotionClipTime("walk", phase) / locomotionClipTime("run", phase)).toBeCloseTo(
      WALK_DURATION / RUN_DURATION
    );
  });
});
