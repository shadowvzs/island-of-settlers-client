import { expect, it } from "vitest";

import { BUILDING_CATALOG, getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";

it("keeps the explicitly requested compact plots and the original well scale", () => {
  for (const [id, width, depth] of [[1, 4, 4], [2, 5, 4], [4, 3, 4], [14, 3, 4], [17, 4, 4], [18, 4, 4],
    [20, 4, 4], [22, 4, 4], [23, 5, 5], [31, 5, 4], [35, 2, 2]])
    expect(getBuildingDefinition(id!).gridFootprint).toEqual([width, depth]);
  expect(getRomanBuildingWorldSizing(getBuildingDefinition(35)).scale).toBeCloseTo(.8745794398886244);
});

it("fits every ordinary house within six cells per axis and fills large plots proportionally", () => {
  for (const definition of BUILDING_CATALOG) {
    const sizing = getRomanBuildingWorldSizing(definition);
    if (sizing.policy.category === "house") expect(Math.max(...sizing.cells)).toBeLessThanOrEqual(6);
    if (!sizing.policy.fillLargeModel) continue;
    expect(Math.min(...sizing.cells)).toBeGreaterThanOrEqual(6);
    // This measures the complete ground geometry, not a larger invisible padded reservation.
    expect(Math.max(sizing.groundBounds.width, sizing.groundBounds.depth) * sizing.scale).toBeGreaterThanOrEqual(5.88 - 1e-8);
  }
});

it("records smoke as a non-solid overlay without giving it ground collision space", () => {
  const smelter = getRomanBuildingWorldSizing(getBuildingDefinition(26));
  expect(smelter.cells).toEqual([6, 5]);
  expect(smelter.effects).toHaveLength(1);
  expect(smelter.effects[0]!.solid).toBe(false);
  expect(smelter.bounds.width).toBeGreaterThan(smelter.groundBounds.width);
});
