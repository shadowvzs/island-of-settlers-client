import { expect, it } from "vitest";

import { advancedMaterialBase, withAdvancedMaterialStocks } from "../src/render-common/buildings/advanced-material-buildings";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getBuildingCategory } from "../src/render-common/buildings/building-menu-groups";
import type { BuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanRecipeBounds } from "../src/render-common/buildings/building-recipe-fit";
import { isIndigenousGraniteQuarry } from "../src/render-common/buildings/indigenous-quarry-bearing";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { getConstructionCost } from "../src/shared/settlement/construction-costs";

it.each([41, 42, 43])("specialist %s retains original plot, door and work anchors across nations", id => {
  const definition = getBuildingDefinition(id);
  const base = getBuildingDefinition(advancedMaterialBase(id)!);
  expect(definition.gridFootprint).toEqual(base.gridFootprint);
  expect(getBuildingCategory(id)).toBe(getBuildingCategory(base.id));
  // CAT7: each building's cost follows its own measured model inputs; the specialist keeps the base's materials.
  expect(Object.keys(getConstructionCost(id))).toEqual(Object.keys(getConstructionCost(base.id)));
  for (const nation of ["roman", "viking", "nubian", "japanese"] as const)
    for (const detailed of [true, false]) {
      const recipe = createNationBuildingRecipe(definition, nation, detailed);
      const original = createNationBuildingRecipe(base, nation, detailed);
      // Japanese (like Indigenous) specialists keep the base architecture by design (041bde88c).
      if (nation !== "japanese")
        expect(recipe.parts.filter(part => !part.stock)).not.toEqual(original.parts.filter(part => !part.stock));
      const bounds = getRomanRecipeBounds(definition, recipe);
      const originalBounds = getRomanRecipeBounds(base, original);
      expect(bounds.extentX).toBeLessThanOrEqual(originalBounds.extentX + .00001);
      expect(bounds.extentZ).toBeLessThanOrEqual(originalBounds.extentZ + .00001);
      expect(recipe.door).toEqual(original.door);
      expect(recipe.doorDimensions).toEqual(original.doorDimensions);
      expect(recipe.workerExit).toEqual(original.workerExit);
      expect(recipe.workPoint).toEqual(original.workPoint);
      expect(recipe.mechanism).toEqual(original.mechanism);
      const stock = recipe.parts.flatMap(part => part.stock ? [part.stock.ware] : []);
      if (id === 42) expect(stock).toContain("hardwoodLogs");
      if (id === 43) expect(stock).toContain("marble");

    }
});

it("keeps permanent architecture colours independent from specialist resource tiers", () => {
  for (const nation of ["roman", "viking", "nubian", "japanese", "indigenous", "chinese", "persian", "maya"] as const)
    for (const detailed of [true, false]) for (const id of [45, 46, 47, 49, 50, 51, 53, 54, 55]) {
      const original = createNationBuildingRecipe(getBuildingDefinition(advancedMaterialBase(id)!), nation, detailed);
      const tier = withAdvancedMaterialStocks(original, id, detailed, false);
      // The Indigenous granite quarry (55) always rebuilds its stock bench as a bearing (resource-19
      // workyard); every other permanent part keeps its colour and shape.
      const permanent = (recipe: BuildingRecipe) => recipe.parts.filter(part => !part.stock &&
        !(isIndigenousGraniteQuarry(tier) && part.workyardAssembly === "resource-19"));
      expect(permanent(tier), `${nation}/${id}/${detailed}/architecture`).toEqual(permanent(original));
      if (advancedMaterialBase(id) === 20) continue;
      expect(tier.parts.filter(part => part.stock).map(part => part.stock!.ware))
        .not.toEqual(original.parts.filter(part => part.stock).map(part => part.stock!.ware));
    }
});
