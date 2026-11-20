import { describe, expect, it } from "vitest";

import { type CameraMove, cameraTrackDuration, evaluateCameraTrack, shakeOffset } from
  "../src/app/campaign/cinematics/camera-track";
import { letterboxBarHeight } from "../src/app/campaign/cinematics/helpers";
import type { CameraOrbit } from "../src/render-common/cinematic/cinematic-frame";

const orbit = (overrides: Partial<CameraOrbit> = {}): CameraOrbit => ({
  distance: 40, fov: 0.5, pitch: 0.6, targetX: 10, targetY: 0, targetZ: 10, yaw: 0, ...overrides
});

const expectOrbit = (actual: CameraOrbit, expected: CameraOrbit) => {
  for (const key of Object.keys(expected) as (keyof CameraOrbit)[]) expect(actual[key]).toBeCloseTo(expected[key], 9);
};

const start = orbit();
const shotA = orbit({ distance: 20, targetX: 30, yaw: 1 });
const shotB = orbit({ distance: 60, pitch: 0.3, targetZ: 50, yaw: -1 });
const moves: CameraMove[] = [
  { drift: { distanceTo: 10, durationMs: 1000, ease: "linear", yawBy: 0.5 }, ease: "easeInOut", to: shotA,
    transitionMs: 2000 },
  { ease: "linear", to: shotB, transitionMs: 1000 },
  { ease: "easeInOut", to: start, transitionMs: 500 }
];

describe("cinematic camera track", () => {
  it("sums transitions and drifts", () => {
    expect(cameraTrackDuration(moves)).toBe(4500);
  });

  it("starts at the drawn pose, arrives at each shot and restores the start exactly", () => {
    expectOrbit(evaluateCameraTrack(start, moves, 0), start);
    expectOrbit(evaluateCameraTrack(start, moves, 2000), shotA);
    const drifted = evaluateCameraTrack(start, moves, 3000);
    expect(drifted.distance).toBeCloseTo(10);
    expect(drifted.yaw).toBeCloseTo(1.5);
    expectOrbit(evaluateCameraTrack(start, moves, 4000), shotB);
    // Past the end it holds the restored start (the override then drops onto the untouched RTS camera).
    expectOrbit(evaluateCameraTrack(start, moves, 9000), start);
  });

  it("starts the next move from where the drift ended (no jump)", () => {
    const beforeB = evaluateCameraTrack(start, moves, 2999.999);
    const afterB = evaluateCameraTrack(start, moves, 3000.001);
    expect(afterB.distance).toBeCloseTo(beforeB.distance, 2);
    expect(afterB.targetX).toBeCloseTo(beforeB.targetX, 2);
  });

  it("fades the shake out to nothing", () => {
    const early = shakeOffset(1, 0.1, 0.37);
    expect(Math.abs(early.x) + Math.abs(early.yaw)).toBeGreaterThan(0);
    expect(shakeOffset(1, 1, 0.37)).toEqual({ pitch: 0, x: 0, y: 0, yaw: 0 });
  });
});

describe("cinematic presentation helpers", () => {
  it("crops landscape to 2:1 and caps portrait bars at 6 %", () => {
    expect(letterboxBarHeight(1920, 1080)).toBe(60);
    expect(letterboxBarHeight(2400, 1000)).toBe(0);
    expect(letterboxBarHeight(400, 800)).toBeCloseTo(48);
  });
});
