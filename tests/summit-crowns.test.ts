import { describe, expect, it } from "vitest";

import { roundSummitCrowns } from "../src/shared/world/generation/summit-crowns";

const GRID = { cellsX: 20, cellsZ: 20 };
const STRIDE = 21;

/** Heights of `height(x, z)` and a full-strength mountain mask on the test grid. */
const surface = (height: (x: number, z: number) => number) => {
  const heights = new Float32Array(STRIDE * STRIDE);
  for (let z = 0; z <= 20; z++) for (let x = 0; x <= 20; x++) heights[z * STRIDE + x] = height(x, z);
  return { heights, mask: new Float32Array(heights.length).fill(1) };
};

describe("WALL-PATCHES summit crowns", () => {
  it("blunts a needle summit and keeps its foot", () => {
    const { heights, mask } = surface((x, z) => 16 - 1.6 * Math.hypot(x - 10, z - 10));
    roundSummitCrowns(GRID, heights, mask);
    expect(heights[10 * STRIDE + 10]).toBeLessThan(15.2);
    expect(heights[10 * STRIDE + 10]).toBeGreaterThan(13);
    expect(heights[10 * STRIDE + 4]).toBeCloseTo(16 - 1.6 * 6, 3);
  });

  it("leaves faces, gullies and lowland unchanged", () => {
    const face = surface((x, z) => 6 + x * 0.6 + 2 * Math.min(1, Math.abs(z - 10) / 4));
    const before = face.heights.slice();
    roundSummitCrowns(GRID, face.heights, face.mask);
    expect(face.heights[10 * STRIDE + 10]).toBe(before[10 * STRIDE + 10]);
    expect(face.heights[3 * STRIDE + 10]).toBe(before[3 * STRIDE + 10]);
    const low = surface((x, z) => 4 - 0.5 * Math.hypot(x - 10, z - 10));
    const lowBefore = low.heights.slice();
    roundSummitCrowns(GRID, low.heights, low.mask);
    expect(low.heights).toEqual(lowBefore);
  });
});
