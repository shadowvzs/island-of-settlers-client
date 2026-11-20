import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";

const HEADQUARTERS = getBuildingDefinition(0);

it.each([true, false])("crowns the Viking HQ tower with Thor on a small plinth, no deck (detail: %s)", detailed => {
  const { parts } = createNationBuildingRecipe(HEADQUARTERS, "viking", detailed);
  const statues = parts.filter(part => part.shape === "thor-statue");
  const plinth = parts.find(part => part.shape === "rune-plinth")!;
  expect(statues).toHaveLength(1);
  const feet = getRomanPartBounds(statues[0]!).min[1], plinthBounds = getRomanPartBounds(plinth);
  // He stands on the plinth (his authoring box starts just below his soles).
  expect(Math.abs(feet - plinthBounds.max[1])).toBeLessThan(.01);
  // Nothing at the statue's level is wider than the tower crown: no platform or railing round him.
  const crownLevel = plinthBounds.min[1] - .08;
  const wide = parts.filter(part => getRomanPartBounds(part).min[1] >= crownLevel &&
    Math.max(part.size[0], part.size[2]) > .5 && part.shape !== "thor-statue");
  expect(wide).toEqual([]);
});

it("keeps Thor out of the other nations' headquarters", () => {
  for (const nation of ["roman", "nubian", "japanese"] as const)
    expect(createNationBuildingRecipe(HEADQUARTERS, nation).parts.some(part => part.shape === "thor-statue"))
      .toBe(false);
});
