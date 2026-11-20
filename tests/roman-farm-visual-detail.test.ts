import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { withRomanMasonryTextureScale } from "../src/render-common/buildings/building-texture-scale";
import { addRomanFarmVisualDetail } from "../src/render-common/buildings/roman-farm-visual-detail";

it.each([true, false])("farm detail retains anchors, stocks and complete horizontal envelope (%s)", detailed => {
  const recipe = createRomanBuildingRecipe(getBuildingDefinition(37), detailed, false);
  const before = structuredClone(recipe);
  addRomanFarmVisualDetail(recipe, detailed);
  expect({ ...recipe, parts: before.parts }).toEqual(before);
  const bounds = before.parts.map(part => getRomanPartBounds(part));
  const min = [0, 2].map(axis => Math.min(...bounds.map(bound => bound.min[axis]!)));
  const max = [0, 2].map(axis => Math.max(...bounds.map(bound => bound.max[axis]!)));
  for (const part of recipe.parts.slice(before.parts.length)) {
    const box = getRomanPartBounds(part);
    for (const [index, axis] of [0, 2].entries()) {
      expect(box.min[axis]).toBeGreaterThanOrEqual(min[index]!);
      expect(box.max[axis]).toBeLessThanOrEqual(max[index]!);
    }
    expect(part.stock).toBeUndefined();
    expect(box.min[0]! > -.18 || box.max[0]! < -.86).toBe(true);
  }
});

it("HQ/Harbour keep their baseline recipes while profession signs survive", () => {
  for (const id of [0,39]) {
    const base = createRomanBuildingRecipe(getBuildingDefinition(id), true, false);
    const revised = createRomanBuildingRecipe(getBuildingDefinition(id));
    expect(revised).toEqual({ ...base, parts: withRomanMasonryTextureScale(base.parts) });
  }
  expect(createRomanBuildingRecipe(getBuildingDefinition(37)).parts.some(part => part.surface === "paint")).toBe(true);
});
