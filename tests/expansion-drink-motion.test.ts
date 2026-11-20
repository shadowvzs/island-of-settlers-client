import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { expansionDrinkWorkstation } from "../src/render-common/buildings/expansion-drink-maker-layout";
import { decorateExpansionDrinkMaker } from "../src/render-common/buildings/expansion-drink-makers";
import {
  DRINK_MOTION_SECONDS, expansionDrinkHandTarget, sampleExpansionDrinkMotion
} from "../src/render-common/buildings/expansion-drink-motion";

const NATIONS = ["chinese", "persian", "maya", "indigenous"] as const;

it("keeps each moving tool bound in both LODs and closes its loop within the production cycle", () => {
  for (const nation of NATIONS) {
    for (const detailed of [true, false]) {
      const recipe = decorateExpansionDrinkMaker(
        createRomanBuildingRecipe(getBuildingDefinition(6), detailed, false), 6, nation, detailed);
      expect(recipe.parts.filter(part => part.drinkTool === nation)).toHaveLength(1);
    }
    const start = sampleExpansionDrinkMotion(nation, 0), end = sampleExpansionDrinkMotion(nation, 16);
    for (const property of ["offset", "rotation"] as const)
      for (const axis of [0, 1, 2]) expect(end[property][axis]).toBeCloseTo(start[property][axis]!, 10);
    expect(16 % DRINK_MOTION_SECONDS).toBe(0);
  }
});

it("keeps both hands at the real workbench after all four placement rotations", () => {
  for (const nation of NATIONS) for (let turn = 0; turn < 4; turn++) {
    const rotation = turn * Math.PI / 2, scale = 1.4545454545454546;
    const layout = expansionDrinkWorkstation(nation);
    for (let elapsed = 0; elapsed <= 16; elapsed += .25) for (const right of [true, false]) {
      const hand = expansionDrinkHandTarget({ elapsed, nation, origin: [13, 2, -7], rotation, scale }, right);
      const deltaX = hand[0] - 13, deltaZ = hand[2] + 7;
      const x = (deltaX * Math.cos(rotation) - deltaZ * Math.sin(rotation)) / scale;
      const z = (deltaX * Math.sin(rotation) + deltaZ * Math.cos(rotation)) / scale;
      expect(Math.hypot(x - layout.machineBase[0], z - layout.machineBase[2])).toBeLessThan(.17);
      expect((hand[1] - 2) / scale).toBeGreaterThan(layout.workHeight);
      expect((hand[1] - 2) / scale).toBeLessThan(.61);
    }
  }
});
