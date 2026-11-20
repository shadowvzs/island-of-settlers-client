import { describe, expect, it } from "vitest";

import type { ShapeFields } from "../src/shared/world/generation/heights";
import { applySurfaceDetail } from "../src/shared/world/generation/surface-detail";

const grid = { cellsX: 48, cellsZ: 48 };

const fields = (): ShapeFields => {
  const count = (grid.cellsX + 1) * (grid.cellsZ + 1);
  return {
    cliffMask: new Float32Array(count),
    continentalness: new Float32Array(count).fill(1),
    mountainMask: new Float32Array(count)
  };
};

describe("generated island surface detail", () => {
  it("breaks up flat lowland without creating a flat-to-gentle cell rise", () => {
    const heights = new Float32Array((grid.cellsX + 1) * (grid.cellsZ + 1)).fill(3);
    applySurfaceDetail(grid, heights, fields(), 17);
    const mean = heights.reduce((sum, height) => sum + height, 0) / heights.length;
    const variance = heights.reduce((sum, height) => sum + (height - mean) ** 2, 0) / heights.length;
    expect(variance).toBeGreaterThan(0.002);
    const stride = grid.cellsX + 1;
    let maxRise = 0;
    for (let z = 0; z <= grid.cellsZ; z += 1) {
      for (let x = 0; x < grid.cellsX; x += 1) {
        const index = z * stride + x;
        maxRise = Math.max(maxRise, Math.abs(heights[index]! - heights[index + 1]!));
      }
    }
    for (let z = 0; z < grid.cellsZ; z += 1) {
      for (let x = 0; x <= grid.cellsX; x += 1) {
        const index = z * stride + x;
        maxRise = Math.max(maxRise, Math.abs(heights[index]! - heights[index + stride]!));
      }
    }
    // The flat/gentle threshold is 0.35, so a level field stays flat (and buildable) everywhere.
    expect(maxRise).toBeLessThan(0.35);
  });

  it("is deterministic, and leaves the sea, coast and mountain massifs unchanged", () => {
    const shape = fields(), stride = grid.cellsX + 1;
    for (let x = 0; x <= grid.cellsX; x += 1) shape.continentalness[x] = 0;
    for (let z = 0; z <= 5; z += 1)
      for (let x = 0; x <= grid.cellsX; x += 1) shape.mountainMask[z * stride + x] = 1;
    const heights = new Float32Array(shape.continentalness.length).fill(3);
    applySurfaceDetail(grid, heights, shape, 17);
    const again = new Float32Array(shape.continentalness.length).fill(3);
    applySurfaceDetail(grid, again, shape, 17);
    expect(again).toEqual(heights);
    for (let x = 0; x <= grid.cellsX; x += 1) expect(heights[x]).toBe(3);
    for (let z = 0; z <= 5; z += 1)
      for (let x = 0; x <= grid.cellsX; x += 1) expect(heights[z * stride + x]).toBe(3);
  });
});
