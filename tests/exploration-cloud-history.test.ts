import { describe, expect, it } from "vitest";

import {
  advanceCloudDrift,
  CLOUD_HISTORY_GAP_MS,
  CLOUD_HISTORY_TIME_CONSTANT_MS,
  CLOUD_HISTORY_WEIGHT,
  cloudHistoryWeight
} from "../src/renderers/three/exploration-weather/exploration-cloud-history";
import {
  EXPLORATION_CLOUD_RESOLVE_GLSL
} from "../src/renderers/three/exploration-weather/exploration-cloud-resolve-glsl";

describe("cloud history policy", () => {
  it("keeps ~20 frames at 60 fps and fades by time on slower frames", () => {
    expect(cloudHistoryWeight(1000 / 60)).toBe(CLOUD_HISTORY_WEIGHT);
    expect(cloudHistoryWeight(8)).toBe(CLOUD_HISTORY_WEIGHT);
    // 15 fps keeps about the former fixed 0.9; a 250 ms catch-up frame keeps well under it.
    const fifteenFps = 1000 / 15;
    expect(cloudHistoryWeight(fifteenFps)).toBeCloseTo(Math.exp(-fifteenFps / CLOUD_HISTORY_TIME_CONSTANT_MS), 6);
    expect(cloudHistoryWeight(1000 / 15)).toBeGreaterThan(0.85);
    expect(cloudHistoryWeight(250)).toBeLessThan(0.65);
    // A second of slow frames leaves little history: no multi-second smear of the drift.
    expect(cloudHistoryWeight(250) ** 4).toBeLessThan(0.15);
  });

  it("restarts after a long gap, on the first frame and on a broken clock", () => {
    expect(cloudHistoryWeight(CLOUD_HISTORY_GAP_MS + 1)).toBe(0);
    expect(cloudHistoryWeight(Infinity)).toBe(0);
    expect(cloudHistoryWeight(Number.NaN)).toBe(0);
    expect(cloudHistoryWeight(-5)).toBe(0);
  });

  it("hands the resolve the lower-layer drift since the previous render", () => {
    const previous = new Float32Array(2), delta = new Float32Array(2);
    advanceCloudDrift([10, -4, 1, 1], previous, delta);
    advanceCloudDrift([10.5, -3, 1, 1], previous, delta);
    expect(Array.from(delta)).toEqual([0.5, 1]);
    advanceCloudDrift([Number.NaN, 2, 0, 0], previous, delta);
    expect(Number.isFinite(delta[0])).toBe(true);
  });

  it("reprojects by rotation and wind, reads history sharply and skips it on restart", () => {
    expect(EXPLORATION_CLOUD_RESOLVE_GLSL).toContain("previousCloudDirection(direction");
    expect(EXPLORATION_CLOUD_RESOLVE_GLSL).toContain("vec4 sampleHistory(vec2 uv)");
    expect(EXPLORATION_CLOUD_RESOLVE_GLSL).toContain("if (!(uHistoryWeight > 0.0))");
  });
});
