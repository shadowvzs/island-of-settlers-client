import { expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds, getRomanRecipeBounds } from "../src/render-common/buildings/building-recipe-fit";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";

it.each(["viking", "nubian", "japanese"] as const)("preserves all operational contracts for the %s architecture", nation => {
  for (const detailed of [true, false]) for (const definition of BUILDING_CATALOG) {
    // Other nations retain their baseline architecture during the Roman-only roof revision.
    const original = createRomanBuildingRecipe(definition, detailed, false);
    const recipe = createNationBuildingRecipe(definition, nation, detailed);
    const { parts: originalParts, ...originalAnchors } = original, { parts, ...anchors } = recipe;
    // The Viking HQ flies its flag from a mast on the porch ridge (tests/viking-decor.test.ts).
    if (nation === "viking" && definition.id === 0) anchors.flagAnchor = originalAnchors.flagAnchor;
    expect(anchors, `${nation}/${definition.id}/anchors`).toEqual(originalAnchors);
    expect(parts.filter(part => part.stock), `${nation}/${definition.id}/stocks`)
      .toEqual(originalParts.filter(part => part.stock));
    const before = getRomanRecipeBounds(definition, original), after = getRomanRecipeBounds(definition, recipe);
    expect(after.extentX, `${nation}/${definition.id}/x`).toBeLessThanOrEqual(before.extentX + .00001);
    expect(after.extentZ, `${nation}/${definition.id}/z`).toBeLessThanOrEqual(before.extentZ + .00001);
    expect(parts.some(part => part.surface === "roof")).toBe(originalParts.some(part => part.surface === "roof"));
    expect(parts.some(part => part.shape === "tile")).toBe(false);
    expect(parts.every(part => [...part.position, ...part.size].every(Number.isFinite))).toBe(true);
  }
});

it("keeps the complete original Roman recipe unchanged", () => {
  for (const definition of BUILDING_CATALOG) for (const detailed of [true, false])
    expect(createNationBuildingRecipe(definition, "roman", detailed)).toEqual(createRomanBuildingRecipe(definition, detailed));
});

it.each(["viking", "nubian", "japanese"] as const)("keeps a worker-sized entrance lane clear for %s", nation => {
  for (const definition of BUILDING_CATALOG.filter(building => building.style !== "well"))
    for (const detailed of [true, false]) {
      const recipe = createNationBuildingRecipe(definition, nation, detailed);
      const center = recipe.door[0] + (recipe.doorDimensions?.width ?? .46) / 2;
      const front = recipe.door[2] - .016;
      const blocked = recipe.parts.filter(part => {
        if (part.shape === "stone-arc") return false; // Unchanged shared curved masonry has its own exact-sector gate.
        const { max, min } = getRomanPartBounds(part);
        return min[0] < center + .31 && max[0] > center - .31 && min[1] < .82 && max[1] > .025 &&
          min[2] < front + .95 && max[2] > front + .19;
      });
      expect(blocked, `${nation}/${definition.id}/${detailed}`).toEqual([]);
    }
});
