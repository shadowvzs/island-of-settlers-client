import { expect, it } from "vitest";

import { getBuildingTerrainBase } from "../src/render-common/buildings/building-terrain-base";
import { paintBuildingPlotDirt } from "../src/shared/settlement/settlement-plot-ground";
import { MATERIAL, MATERIAL_COUNT, type WorldData } from "../src/shared/world/world-data";

it("paints the original terrain within the masonry base, preserving water, heights and ore", () => {
  const size = 20, count = (size + 1) ** 2;
  const world = { cellsX: size, cellsZ: size, splat: new Uint8Array(count * MATERIAL_COUNT),
    heights: new Float32Array(count).fill(3), waterDepth: new Float32Array(count),
    oreAmount: new Uint8Array(size * size).fill(6) } as unknown as WorldData;
  for (let vertex = 0; vertex < count; vertex++) world.splat[vertex * MATERIAL_COUNT + MATERIAL.grass] = 255;
  world.waterDepth[10 * (size + 1) + 10] = 1;
  const originalHeights = world.heights.slice(), originalOre = world.oreAmount.slice();
  const base = getBuildingTerrainBase(17, 10, 10, 1)!;
  expect(base.width).toBeLessThan(4);
  paintBuildingPlotDirt(world, base);
  let changed = 0;
  for (let z = 0; z <= size; z++) for (let x = 0; x <= size; x++) {
    const vertex = z * (size + 1) + x;
    if (!world.splat[vertex * MATERIAL_COUNT + MATERIAL.dirt]) continue;
    changed++;
    expect(Math.abs(x - base.x)).toBeLessThan(base.width / 2);
    expect(Math.abs(z - base.z)).toBeLessThan(base.depth / 2);
    expect(world.waterDepth[vertex]).toBe(0);
  }
  expect(changed).toBeGreaterThan(0);
  expect(world.heights).toEqual(originalHeights);
  expect(world.oreAmount).toEqual(originalOre);
});
