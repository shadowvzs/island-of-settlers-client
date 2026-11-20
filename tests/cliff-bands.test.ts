import { describe, expect, it } from "vitest";

import { applyCliffBands } from "../src/shared/world/generation/cliff-bands";
import type { ShapeFields } from "../src/shared/world/generation/heights";

const SIZE = 64;
const GRID = { cellsX: SIZE, cellsZ: SIZE };
const STRIDE = SIZE + 1;

/** A gentle ramp from 0.5 to 9 along x, all of it terrace ground (cliff mask 1, no massif). */
const createRamp = () => {
  const count = STRIDE * STRIDE, heights = new Float32Array(count);
  for (let index = 0; index < count; index++) heights[index] = 0.5 + (index % STRIDE) / SIZE * 8.5;
  const fields: ShapeFields = {
    cliffMask: new Float32Array(count).fill(1),
    continentalness: new Float32Array(count).fill(1),
    mountainMask: new Float32Array(count)
  };
  return { fields, heights };
};

const SITES = { keepOut: () => false, start: { x: 3.5, z: 32.5 } };

const steepestStep = (heights: Float32Array) => {
  let steepest = 0;
  for (let index = 0; index < heights.length - 1; index++) {
    if (index % STRIDE === SIZE) continue;
    steepest = Math.max(steepest, Math.abs(heights[index + 1]! - heights[index]!));
  }
  return steepest;
};

describe("tall cliff bands (MC-07)", () => {
  it("is off without an amount", () => {
    const { fields, heights } = createRamp();
    const before = Array.from(heights);
    expect(applyCliffBands(GRID, heights, fields, 7, undefined, SITES)).toBeUndefined();
    expect(applyCliffBands(GRID, heights, fields, 7, 0, SITES)).toBeUndefined();
    expect(Array.from(heights)).toEqual(before);
  });

  it("steps the ground into tiers with walls of about three levels", () => {
    const { fields, heights } = createRamp();
    const talus = applyCliffBands(GRID, heights, fields, 7, 1, SITES)!;
    expect(steepestStep(heights)).toBeGreaterThan(1.5);
    expect(Math.max(...talus)).toBeGreaterThan(100);
    expect(talus.some(value => value > 1 && value < 3)).toBe(true);
  });

  it("keeps out of the start and other kept areas", () => {
    const { fields, heights } = createRamp();
    const before = Float32Array.from(heights);
    applyCliffBands(GRID, heights, fields, 7, 1, { ...SITES, keepOut: () => true });
    expect(Array.from(heights)).toEqual(Array.from(before));
  });

  it("is deterministic", () => {
    const first = createRamp(), second = createRamp();
    applyCliffBands(GRID, first.heights, first.fields, 7, 1, SITES);
    applyCliffBands(GRID, second.heights, second.fields, 7, 1, SITES);
    expect(Array.from(first.heights)).toEqual(Array.from(second.heights));
  });
});
