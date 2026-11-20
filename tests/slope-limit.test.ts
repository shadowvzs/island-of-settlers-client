import { describe, expect, it } from "vitest";

import { limitSlopes } from "../src/shared/world/generation/slope-limit";

const GRID = { cellsX: 8, cellsZ: 8 };
const STRIDE = GRID.cellsX + 1;
const COUNT = STRIDE * (GRID.cellsZ + 1);
const CENTRE = 4 * STRIDE + 4;

/** A flat land square with one tall spike in the middle. */
const createSpike = () => {
  const heights = new Float32Array(COUNT);
  heights[CENTRE] = 20;
  return heights;
};

const land = new Float32Array(COUNT).fill(1);

/** Steepest rise from the spike vertex to one of its four axis neighbours. */
const steepestAxisRise = (heights: Float32Array) =>
  Math.max(...[1, -1, STRIDE, -STRIDE].map(offset => heights[CENTRE]! - heights[CENTRE + offset]!));

describe("zone-aware talus limit", () => {
  it("keeps the original output without a scale", () => {
    const plain = createSpike();
    const unscaled = createSpike();
    limitSlopes(GRID, plain, land);
    limitSlopes(GRID, unscaled, land, undefined);
    expect(Array.from(unscaled)).toEqual(Array.from(plain));
    expect(steepestAxisRise(plain)).toBeLessThanOrEqual(1.3 + 1e-4);
  });

  it("keeps a steeper face inside a zone of scale 2", () => {
    const heights = createSpike();
    const scale = new Float32Array(COUNT).fill(2);
    limitSlopes(GRID, heights, land, scale);
    expect(steepestAxisRise(heights)).toBeGreaterThan(1.3 * 1.5);
    expect(steepestAxisRise(heights)).toBeLessThanOrEqual(2.6 + 1e-4);
  });

  it("uses the smaller scale of a pair, so the zone border relaxes as before", () => {
    const heights = createSpike();
    const scale = new Float32Array(COUNT).fill(1);
    scale[CENTRE] = 2;
    limitSlopes(GRID, heights, land, scale);
    expect(steepestAxisRise(heights)).toBeLessThanOrEqual(1.3 + 1e-4);
  });
});
