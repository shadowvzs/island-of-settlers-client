import { expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { unsupportedParts } from "./helpers/recipe-supports";

const DETAIL_VARIANTS = BUILDING_CATALOG.flatMap((definition) => [
  { ...definition, detailed: true },
  { ...definition, detailed: false }
]);

it.each(DETAIL_VARIANTS)("$name (detail: $detailed) decorations connect to ground or structure", (definition) => {
  expect(unsupportedParts(createRomanBuildingRecipe(definition, definition.detailed))).toEqual([]);
});

const NATION_VARIANTS = (["viking", "nubian", "japanese"] as const).flatMap(nation =>
  DETAIL_VARIANTS.map(definition => ({ ...definition, nation })));

it.each(NATION_VARIANTS)("$nation $name (detail: $detailed) has no floating pieces", (definition) => {
  // Every nation building is checked whole: rebuilt walls and roofs, corner posts, kept Roman
  // props and the nation designs (Woodcutter, Tavern yard and street front).
  expect(unsupportedParts(createNationBuildingRecipe(definition, definition.nation, definition.detailed))).toEqual([]);
});
