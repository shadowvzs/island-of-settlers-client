import { expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { decorativeWeaponsFor, withNationDecorativeRacks } from "../src/render-common/buildings/national-decorative-weapons";
import type { WorkerNation } from "../src/render-common/workers/worker-unit";

const nations: WorkerNation[] = ["roman", "viking", "japanese", "nubian", "chinese", "persian", "maya", "indigenous"];
it("varies one or two decorative national arms and leaves some occupations without racks", () => {
  expect(decorativeWeaponsFor("viking", 1)).toEqual(["axe"]);
  expect(decorativeWeaponsFor("viking", 2)).toEqual(["axe", "axe"]);
  expect(decorativeWeaponsFor("maya", 2)).toEqual(["club", "spear"]);
  expect(decorativeWeaponsFor("indigenous", 2)).toEqual(["bow", "club"]);
  for (const nation of nations) {
    expect(decorativeWeaponsFor(nation, 14)).toEqual([]);
    expect(decorativeWeaponsFor(nation, 40)).toEqual([]);
    expect(decorativeWeaponsFor(nation, 62)).toHaveLength(2);
  }
});

it("exchanges only tagged decorations while preserving every gameplay anchor and ware stock", () => {
  for (const detailed of [false, true]) for (const definition of BUILDING_CATALOG) {
    const original = createRomanBuildingRecipe(definition, detailed, false);
    const { parts: originalParts, ...metadata } = original;
    for (const nation of nations) {
      const { parts, ...resultMetadata } = withNationDecorativeRacks(original, nation, detailed);
      expect(resultMetadata).toEqual(metadata);
      expect(parts.filter(part => part.stock)).toEqual(originalParts.filter(part => part.stock));
      expect(parts.filter(part => part.decorativeRack === undefined))
        .toEqual(originalParts.filter(part => part.decorativeRack === undefined));
      expect(parts.filter(part => part.decorativeRack !== undefined).every(part => !part.stock)).toBe(true);
    }
  }
});
