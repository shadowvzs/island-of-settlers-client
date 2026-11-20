import { describe, expect, it } from "vitest";

import { computeCoastTypes } from "../src/shared/world/generation/coast-types";
import { getSeabedDepth, shapeSeabed } from "../src/shared/world/generation/seabed";
import type { GridSize } from "../src/shared/world/grid-geometry";

const GRID: GridSize = { cellsX: 96, cellsZ: 96 };
const STRIDE = GRID.cellsX + 1;
/** Land for z below the coast row, sea from it on (the coast runs along x). */
const COAST_Z = 30;
/** x below: a beach (gentle rise), from it on: a cliff (steep rise). */
const SPLIT_X = 48;
const SEED = 77;

const createCoastHeights = () => {
  const heights = new Float32Array(STRIDE * (GRID.cellsZ + 1));
  for (let index = 0; index < heights.length; index += 1) {
    const x = index % STRIDE;
    const inland = COAST_Z - Math.floor(index / STRIDE);
    const rise = x < SPLIT_X ? 0.08 : 1.2;
    heights[index] = inland > 0 ? Math.min(12, inland * rise) : -0.3;
  }
  return heights;
};

const shapeCoast = () => {
  const heights = createCoastHeights();
  const riverMask = new Uint8Array(heights.length);
  shapeSeabed(GRID, SEED, { heights, riverMask, seaLevel: 0 });
  return heights;
};

const depthAt = (heights: Float32Array, x: number, distance: number) =>
  -heights[(COAST_Z + distance) * STRIDE + x]!;

describe("seabed by coast type", () => {
  it("keeps beach shelves, a short cliff ledge and a deeper offshore drop", () => {
    for (let distance = 1; distance <= 12; distance += 1) {
      expect(getSeabedDepth(distance, 0)).toBeLessThan(getSeabedDepth(distance, 1));
    }
    expect(getSeabedDepth(8, 0)).toBeLessThan(1.1);
    expect(getSeabedDepth(3, 1)).toBeLessThan(1.5);
    expect(getSeabedDepth(4, 1)).toBeLessThan(2);
    expect(getSeabedDepth(8, 1)).toBeGreaterThan(4);
  });

  it("reaches the same maximum depth far out for every coast type and shelf relief", () => {
    for (const coastType of [0, 0.5, 1]) {
      for (const shelfScale of [0.4, 1, 1.6]) {
        expect(getSeabedDepth(30, coastType, shelfScale)).toBeCloseTo(5, 3);
        expect(getSeabedDepth(60, coastType, shelfScale)).toBeCloseTo(5, 3);
      }
    }
  });

  it("reads beaches and cliffs from the land behind the shore", () => {
    const types = computeCoastTypes(GRID, createCoastHeights(), 0);
    expect(types[(COAST_Z + 3) * STRIDE + 10]!).toBeLessThan(0.1);
    expect(types[(COAST_Z + 3) * STRIDE + 86]!).toBeGreaterThan(0.9);
  });

  it("is shallower in front of the beach than in front of the cliff", () => {
    const heights = shapeCoast();
    for (let distance = 3; distance <= 12; distance += 1) {
      expect(depthAt(heights, 10, distance)).toBeLessThan(depthAt(heights, 86, distance));
    }
  });

  it("never rises again on the way out from the cliff (only the slight noise)", () => {
    const heights = shapeCoast();
    for (let distance = 2; distance < 60; distance += 1) {
      const rise = depthAt(heights, 86, distance) - depthAt(heights, 86, distance + 1);
      expect(rise).toBeLessThan(0.1);
    }
  });

  it("blends along the coast without steps", () => {
    // A seam would jump the whole beach / cliff difference (about 3) within one cell.
    const heights = shapeCoast();
    for (const distance of [3, 6, 10]) {
      for (let x = 1; x <= GRID.cellsX; x += 1) {
        const step = Math.abs(depthAt(heights, x, distance) - depthAt(heights, x - 1, distance));
        expect(step).toBeLessThan(0.6);
      }
    }
  });

  it("keeps the maximum depth far out and is deterministic", () => {
    const heights = shapeCoast();
    for (let x = 0; x <= GRID.cellsX; x += 8) {
      expect(Math.abs(depthAt(heights, x, 40) - 5)).toBeLessThanOrEqual(0.5 + 1e-6);
    }
    expect(shapeCoast()).toEqual(heights);
  });
});

it("deepens a narrow edge sea sliver without moving land or river mouths", () => {
  const grid = { cellsX: 12, cellsZ: 12 }, stride = 13;
  const heights = Float32Array.from({ length: stride ** 2 }, (_, index) => index % stride === 0 ? -.01 : .5);
  const before = heights.slice(), riverMask = new Uint8Array(heights.length);
  shapeSeabed(grid, 3, { heights, riverMask, seaLevel: 0 });
  expect(heights[6 * stride]).toBeLessThan(-.12);
  for (let index = 0; index < heights.length; index++) if (before[index]! >= 0)
    expect(heights[index]).toBe(before[index]);
  const river = before.slice(); riverMask[6 * stride] = 1;
  shapeSeabed(grid, 3, { heights: river, riverMask, seaLevel: 0 });
  expect(river[6 * stride]).toBe(before[6 * stride]);
});
