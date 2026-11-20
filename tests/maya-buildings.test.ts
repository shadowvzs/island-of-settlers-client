import { expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds, getRomanRecipeBounds } from "../src/render-common/buildings/building-recipe-fit";
import { createMayaBuildingRecipe } from "../src/render-common/buildings/maya-building-recipe";
import { MONUMENT_TYPE_ID } from "../src/render-common/buildings/monument-definition";

it("preserves logistics and inventories for every Maya occupation at both qualities", () => {
  for (const detailed of [true, false]) for (const definition of BUILDING_CATALOG) {
    const original = createRomanBuildingRecipe(definition, detailed, false);
    const recipe = createMayaBuildingRecipe(original, definition, detailed);
    const { parts: originalParts, ...originalAnchors } = original, { parts, ...anchors } = recipe;
    expect(anchors, `${definition.id}/anchors`).toEqual(originalAnchors);
    expect(parts.filter(part => part.stock), `${definition.id}/stock`)
      .toEqual(originalParts.filter(part => part.stock));
    const before = getRomanRecipeBounds(definition, original), after = getRomanRecipeBounds(definition, recipe);
    expect(after.extentX, `${definition.id}/x`).toBeLessThanOrEqual(before.extentX + .00001);
    expect(after.extentZ, `${definition.id}/z`).toBeLessThanOrEqual(before.extentZ + .00001);
    expect(parts.every(part => [...part.position, ...part.size].every(Number.isFinite))).toBe(true);
    expect(parts.some(part => part.shape === "civic-statue" || part.shape === "tile")).toBe(false);
  }
});

it("keeps the shared civilian approach clear at both qualities", () => {
  for (const detailed of [true, false]) for (const definition of BUILDING_CATALOG) {
    if (definition.style === "well" || definition.id === 7) continue;
    const original = createRomanBuildingRecipe(definition, detailed, false);
    const recipe = createMayaBuildingRecipe(original, definition, detailed);
    const centre = recipe.door[0] + (recipe.doorDimensions?.width ?? .46) / 2;
    const front = recipe.door[2] - .016;
    const blocked = recipe.parts.filter(part => {
      if (part.shape === "stone-arc") return false;
      const { max, min } = getRomanPartBounds(part);
      return min[0] < centre + .31 && max[0] > centre - .31 && min[1] < .82 && max[1] > .025 &&
        min[2] < front + .95 && max[2] > front + .19;
    });
    expect(blocked, `${definition.id}/${detailed}/approach`).toEqual([]);
  }
});

it("uses thatch for workhouses, carved limestone for civic seats, and an original stepped monument", () => {
  const recipe = (id: number) => {
    const definition = BUILDING_CATALOG.find(entry => entry.id === id)!;
    return createMayaBuildingRecipe(createRomanBuildingRecipe(definition, true, false), definition, true);
  };
  expect(recipe(17).parts.some(part => part.shape === "occupation-roof" && part.plantRoofStyle === "palm" && part.surface === "palm-thatch")).toBe(true);
  expect(recipe(0).parts.filter(part => part.surface === "cut-stone").length).toBeGreaterThan(20);
  expect(recipe(MONUMENT_TYPE_ID).parts.length).toBeGreaterThan(80);
  expect(recipe(MONUMENT_TYPE_ID).hideDoor).toBe(true);
});

it("replaces mine barrels with corbelled portals and preserves the supporting harbour belfry walls", () => {
  for (const id of [10, 11, 12, 13, 39]) {
    const definition = BUILDING_CATALOG.find(entry => entry.id === id)!;
    const original = createRomanBuildingRecipe(definition, true, false);
    const built = createMayaBuildingRecipe(original, definition, true);
    const structure = original.parts.filter(part => part.shape === "stone-arc" &&
      Math.max(part.size[0], part.size[2]) > .65);
    expect(structure.length, `${id}/source vault`).toBeGreaterThan(0);
    const remaining = built.parts.filter(part => part.shape === "stone-arc" &&
      Math.max(part.size[0], part.size[2]) > .65);
    expect(remaining.length, `${id}/structural replacement`).toBe(id === 39 ? structure.length : 0);
    if (id !== 39) expect(built.parts.some(part => part.surface === "cut-stone" &&
      part.size[0] > .9 && part.position[1] > 1.2)).toBe(true);
  }
});

it("gives the mill receding shaft storeys while keeping its full rotor clearance", () => {
  const definition = BUILDING_CATALOG.find(entry => entry.id === 31)!;
  for (const detailed of [true, false]) {
    const original = createRomanBuildingRecipe(definition, detailed, false);
    const recipe = createMayaBuildingRecipe(original, definition, detailed);
    const shaft = recipe.parts.filter(part => !part.stock &&
      ["plaster", "cut-stone"].includes(part.surface) && part.position[1] > 1.9);
    expect(shaft.length).toBeGreaterThan(4);
    expect(shaft.every(part => getRomanPartBounds(part).max[2] < .455)).toBe(true);
    expect(Math.max(...shaft.map(part => getRomanPartBounds(part).max[0]))).toBeLessThan(.36);
    expect(recipe.mechanism).toEqual(original.mechanism);
  }
});

it("uses an open stepped cistern with clear bucket descent instead of the shared canopy", () => {
  const definition = BUILDING_CATALOG.find(entry => entry.id === 35)!;
  for (const detailed of [true, false]) {
    const original = createRomanBuildingRecipe(definition, detailed, false);
    const recipe = createMayaBuildingRecipe(original, definition, detailed);
    expect(recipe.parts.some(part => part.shape === "occupation-roof" || part.shape === "stone-arc")).toBe(false);
    const [x, , z] = recipe.mechanism;
    const shaft = recipe.parts.filter(part => {
      if (part.stock || part.position[1] > .7) return false;
      const bounds = getRomanPartBounds(part);
      return bounds.min[0] < x + .17 && bounds.max[0] > x - .17 &&
        bounds.min[2] < z + .17 && bounds.max[2] > z - .17;
    });
    expect(shaft).toEqual([]);
    expect(recipe.parts.filter(part => part.stock)).toEqual(original.parts.filter(part => part.stock));
    expect(recipe.mechanism).toEqual(original.mechanism);
  }
});
