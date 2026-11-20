import { describe, expect, it } from "vitest";

import { createSummitMask, createSummitSupport, upliftSummits } from "../src/shared/world/generation/summit-uplift";

const GRID = { cellsX: 40, cellsZ: 40 };

/** A synthetic cone (0 at the rim, 14 at the centre) with a full mountain mask on its upper half. */
const createCone = () => {
  const size = 41, heights = new Float32Array(size * size), mountainMask = new Float32Array(size * size);
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const distance = Math.hypot(x - 20, z - 20);
    heights[z * size + x] = Math.max(0, 14 - distance * 0.7);
    mountainMask[z * size + x] = distance < 14 ? 1 : 0;
  }
  return { heights, mountainMask };
};

describe("summit uplift (MC-04)", () => {
  it("is off without an amount: no talus scale, heights untouched", () => {
    const { heights, mountainMask } = createCone();
    const before = Array.from(heights);
    expect(upliftSummits(GRID, heights, mountainMask, undefined)).toBeUndefined();
    expect(upliftSummits(GRID, heights, mountainMask, 0)).toBeUndefined();
    expect(Array.from(heights)).toEqual(before);
  });

  it("raises the upper massif, never lowers ground and keeps the lowland", () => {
    const { heights, mountainMask } = createCone();
    const before = Float32Array.from(heights);
    const talus = upliftSummits(GRID, heights, mountainMask, 1)!;
    expect(heights[20 * 41 + 20]).toBeGreaterThan(before[20 * 41 + 20]! * 1.4);
    for (let index = 0; index < heights.length; index++) {
      if (before[index]! <= 0.9) expect(heights[index]).toBe(before[index]);
      expect(heights[index]).toBeGreaterThanOrEqual(before[index]!);
      expect(talus[index]).toBeGreaterThanOrEqual(1);
    }
    expect(Math.max(...talus)).toBeGreaterThan(1.8);
  });

  it("keeps the summit zone inside strong mountain masks", () => {
    const { heights } = createCone();
    const weak = new Float32Array(heights.length).fill(0.2);
    expect(Math.max(...createSummitMask(heights, createSummitSupport(GRID, heights), weak))).toBe(0);
  });

  it("lifts a bowl with its rim instead of deepening it", () => {
    const size = 41, heights = new Float32Array(size * size), mountainMask = new Float32Array(size * size).fill(1);
    for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - 20, z - 20);
      heights[z * size + x] = distance < 4 ? 9 : Math.max(0, 13 - Math.abs(distance - 6) * 0.9);
    }
    const before = Float32Array.from(heights);
    upliftSummits(GRID, heights, mountainMask, 1);
    const rimGain = heights[20 * size + 26]! - before[20 * size + 26]!;
    const floorGain = heights[20 * size + 20]! - before[20 * size + 20]!;
    expect(floorGain).toBeGreaterThan(rimGain * 0.6);
  });

  it("is monotonic and deterministic", () => {
    const first = createCone(), second = createCone(), half = createCone();
    upliftSummits(GRID, first.heights, first.mountainMask, 1);
    upliftSummits(GRID, second.heights, second.mountainMask, 1);
    upliftSummits(GRID, half.heights, half.mountainMask, 0.5);
    expect(Array.from(first.heights)).toEqual(Array.from(second.heights));
    expect(half.heights[20 * 41 + 20]).toBeLessThan(first.heights[20 * 41 + 20]!);
  });
});
