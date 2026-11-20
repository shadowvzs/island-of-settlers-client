import { describe, expect, it } from "vitest";

import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { blurLandSplat } from "../src/shared/world/generation/splat-blur";
import { getVertexCount, type GridSize } from "../src/shared/world/grid-geometry";
import { MATERIAL, MATERIAL_COUNT } from "../src/shared/world/world-data";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";

const GRID: GridSize = { cellsX: 12, cellsZ: 12 };

const getFieldMaterial = (x: number) => {
  if (x === 0) return MATERIAL.sand;
  return x < 6 ? MATERIAL.grass : MATERIAL.dirt;
};

/** Grass west of x = 6, dirt east of it; the column x = 0 is sea. */
const createField = () => {
  const splat = new Uint8Array(getVertexCount(GRID) * MATERIAL_COUNT);
  const coast = new Float32Array(getVertexCount(GRID));
  for (let vertex = 0; vertex < getVertexCount(GRID); vertex += 1) {
    const x = vertex % (GRID.cellsX + 1);
    splat[vertex * MATERIAL_COUNT + getFieldMaterial(x)] = 255;
    coast[vertex] = x === 0 ? -1 : x;
  }
  return { coast, splat };
};

const weightAt = (splat: Uint8Array, x: number, material: number) =>
  splat[(6 * (GRID.cellsX + 1) + x) * MATERIAL_COUNT + material]! / 255;

/** Neighbour pairs over land (coast >= 2) where a material changes by more than `step`. */
const countJumps = (splat: Uint8Array, coast: Float32Array, cellsX: number, step: number) => {
  const stride = cellsX + 1;
  let jumps = 0;
  for (let vertex = 0; vertex < coast.length - stride; vertex += 1) {
    for (const neighbour of [vertex + 1, vertex + stride]) {
      if (coast[vertex]! < 2 || coast[neighbour]! < 2) continue;
      for (let material = 0; material < MATERIAL_COUNT; material += 1) {
        const change =
          splat[vertex * MATERIAL_COUNT + material]! -
          splat[neighbour * MATERIAL_COUNT + material]!;
        if (Math.abs(change) > step * 255) jumps += 1;
      }
    }
  }
  return jumps;
};

describe("land splat blur", () => {
  it("turns a one cell edge into a two cell ramp, keeping the sea and the shore row", () => {
    const { coast, splat } = createField();
    blurLandSplat(GRID, splat, coast);
    expect(weightAt(splat, 5, MATERIAL.grass)).toBeCloseTo(0.75, 1);
    expect(weightAt(splat, 6, MATERIAL.grass)).toBeCloseTo(0.25, 1);
    expect(weightAt(splat, 0, MATERIAL.sand)).toBe(1);
    expect(weightAt(splat, 1, MATERIAL.grass)).toBe(1);
    expect(countJumps(splat, coast, GRID.cellsX, 0.55)).toBe(0);
  });

  const ISLAND_128 = { ...DEFAULT_WORLD_OPTIONS, cellsX: 128, cellsZ: 128 };
  preloadWorlds(ISLAND_128);
  it("leaves almost no hard one cell jumps inland on a generated island", () => {
    const world = cachedWorld(ISLAND_128);
    const pairs = world.cellsX * world.cellsZ * 2;
    const jumps = countJumps(world.splat, world.coastDistance, world.cellsX, 0.7);
    expect(jumps / pairs).toBeLessThan(0.002);
  });
});
