import { expect, it } from "vitest";

import { BUILDING_CATALOG, getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getAuthoredBuildingPlot } from "../src/render-common/buildings/building-plot-profile";
import { getBuildingProgressionTier } from "../src/render-common/buildings/building-size-tiers";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { createWorkyardReviewPrototype, WORKYARD_REVIEW_TYPES } from "../src/render-common/buildings/workyard-review-prototype";

const nations = ["roman", "viking", "nubian", "japanese", "maya", "persian", "chinese", "indigenous"] as const;

it("preserves the authored plots and scales independently of model bounds", () => {
  for (const definition of BUILDING_CATALOG.filter(building => building.id !== 16)) {
    const authored = getAuthoredBuildingPlot(definition.id)!;
    const sizing = getRomanBuildingWorldSizing(definition);
    expect(sizing.cells).toEqual(authored.reservedCells);
    expect(sizing.scale).toBe(authored.structureScale);
  }
  expect(getBuildingProgressionTier(17)).toBe("small");
  expect(getBuildingProgressionTier(33)).toBe("medium");
});

it("isolates prototypes in one side strip and retains stock, doors and worker anchors", () => {
  for (const nation of nations) for (const detailed of [true, false]) for (const level of [1, 5] as const) {
    for (const id of WORKYARD_REVIEW_TYPES) {
      const definition = getBuildingDefinition(id);
      const original = leveledBuildingRecipe(definition, nation, detailed, level);
      const { profile, recipe } = createWorkyardReviewPrototype(definition, nation, detailed, level)!;
      expect(recipe.parts.slice(0, original.parts.length)).toEqual(original.parts);
      expect(recipe.door).toEqual(original.door);
      expect(recipe.workerExit).toEqual(original.workerExit);
      expect(recipe.workPoint).toEqual(original.workPoint);
      expect(profile.originalCells).toEqual(definition.gridFootprint);
      expect(profile.structureScale).toBe(getRomanBuildingWorldSizing(definition).scale);
      const obstacles = [...profile.staticObstacles, ...profile.stockObstacles];
      for (const obstacle of obstacles) {
        // New physical equipment cannot obstruct any pre-existing building plot or entrance lane.
        expect(obstacle.min[0]).toBeGreaterThanOrEqual(profile.originalCells[0] / 2);
        expect(obstacle.max[0]).toBeLessThanOrEqual(profile.reservedGround.max[0]!);
        expect(obstacle.min[2]).toBeGreaterThanOrEqual(profile.reservedGround.min[1]!);
        expect(obstacle.max[2]).toBeLessThanOrEqual(profile.reservedGround.max[1]!);
      }
      if (id === 8) expect(recipe.parts).toEqual(original.parts);
      if (id === 61) expect(profile.stockObstacles[0]?.stock).toEqual({ ware: "cloth", slot: 0, kind: "output" });
    }
  }
});

it("excludes unchanged HQ, Monument and military control models", () => {
  for (const id of [0, 7, 1, 2, 4, 9, 40, 62, 16])
    expect(createWorkyardReviewPrototype(getBuildingDefinition(id), "roman", true, 1)).toBeUndefined();
});
