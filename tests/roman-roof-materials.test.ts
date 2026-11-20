import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanRecipeBounds } from "../src/render-common/buildings/building-recipe-fit";
import { ROMAN_ROOF_MATERIAL_IDS } from "../src/render-common/buildings/roman-roof-materials";

it.each(ROMAN_ROOF_MATERIAL_IDS)("roof changes retain building %s anchors, stocks and plot envelope", id => {
  for (const detailed of [true, false]) {
    const definition = getBuildingDefinition(id);
    const before = createRomanBuildingRecipe(definition, detailed, false);
    const after = createRomanBuildingRecipe(definition, detailed);
    const { parts: beforeParts, ...beforeAnchors } = before;
    const { parts, ...anchors } = after;
    expect(anchors).toEqual(beforeAnchors);
    expect(parts.filter(part => part.stock)).toEqual(beforeParts.filter(part => part.stock));
    const original = getRomanRecipeBounds(definition, before), current = getRomanRecipeBounds(definition, after);
    expect(current.extentX).toBeLessThanOrEqual(original.extentX + .0001);
    expect(current.extentZ).toBeLessThanOrEqual(original.extentZ + .0001);
    expect(parts.some(part => part.surface.startsWith("roof"))).toBe(true);
  }
});
