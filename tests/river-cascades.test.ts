import { describe, expect, it } from "vitest";

import { findWaterfalls, isLedgeFall, LEDGE_DROP } from "../src/shared/world/generation/river-falls";
import { SAMPLE_SPACING } from "../src/shared/world/generation/river-line";
import { createRiverProfile } from "../src/shared/world/generation/river-profile";
import type { GridSize } from "../src/shared/world/grid-geometry";

const GRID: GridSize = { cellsX: 64, cellsZ: 8 };
const TOP = 12;
const RADIUS = 1;

/** A straight valley falling towards +x with a constant gradient, and a river course down it. */
const createSlope = (gradient: number) => {
  const stride = GRID.cellsX + 1;
  const heights = Float32Array.from({ length: stride * (GRID.cellsZ + 1) }, (_, index) =>
    TOP - (index % stride) * gradient
  );
  const points = Array.from({ length: 112 }, (_, step) => ({ x: 4 + step * SAMPLE_SPACING, z: 4 }));
  /** The mouth lies far beyond the course: no estuary sinking into the sea. */
  const course = { mouthStep: points.length * 4, points };
  const { level } = createRiverProfile(GRID, heights, course, 0);
  return { mouthStep: course.mouthStep, points, profile: level, radius: new Float32Array(points.length).fill(RADIUS) };
};

const getDropSteps = (level: Float32Array, from: number) =>
  level.reduce<number[]>((steps, value, step) => {
    if (step > 0 && level[step - 1]! - value >= from) steps.push(step);
    return steps;
  }, []);

describe("river cascades (step-pool channels)", () => {
  it("steps a cascade reach into small ledges one to four channel widths apart", () => {
    const { profile: level } = createSlope(0.15);
    const ledges = getDropSteps(level, LEDGE_DROP);
    expect(ledges.length).toBeGreaterThan(8);
    for (let index = 1; index < ledges.length; index += 1) {
      const spacing = (ledges[index]! - ledges[index - 1]!) * SAMPLE_SPACING;
      expect(spacing).toBeGreaterThanOrEqual(RADIUS * 2);
      expect(spacing).toBeLessThanOrEqual(RADIUS * 2 * 4);
    }
  });

  it("turns every cascade step into a ledge fall whose pool ends before the next lip", () => {
    const river = createSlope(0.15);
    const falls = findWaterfalls(river);
    expect(falls.length).toBeGreaterThan(8);
    for (let index = 0; index < falls.length; index += 1) {
      const fall = falls[index]!;
      expect(isLedgeFall(fall)).toBe(true);
      expect(fall.poolRadius).toBeGreaterThan(fall.width / 2);
      const next = falls[index + 1];
      if (!next) continue;
      const gap = Math.hypot(next.x - fall.x, next.z - fall.z);
      expect(Math.hypot(fall.poolX - fall.x, fall.poolZ - fall.z) + fall.poolRadius).toBeLessThan(gap + 0.5);
    }
  });

  it("keeps gentle reaches sloped (no ledges below the cascade gradient)", () => {
    expect(getDropSteps(createSlope(0.06).profile, LEDGE_DROP)).toEqual([]);
  });

  it("never lets the water climb and is deterministic", () => {
    const { profile: level } = createSlope(0.15);
    for (let step = 1; step < level.length; step += 1) {
      expect(level[step]!).toBeLessThanOrEqual(level[step - 1]!);
    }
    expect(createSlope(0.15).profile).toEqual(level);
  });
});
