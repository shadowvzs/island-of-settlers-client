import { expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds, getRomanRecipeBounds } from "../src/render-common/buildings/building-recipe-fit";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { persianRoofFamily } from "../src/render-common/buildings/persian-building-architecture";
import { createPersianBuildingRecipe } from "../src/render-common/buildings/persian-building-recipe";
import { unsupportedParts } from "./helpers/recipe-supports";

it("keeps the Persian roster on every original footprint, operational anchor and inventory", () => {
  for (const detailed of [true, false]) for (const definition of BUILDING_CATALOG.filter(entry => entry.id !== 16)) {
    // The actuated national Catapult has its own canonical recipe and dedicated core/contact tests.
    const original = createRomanBuildingRecipe(definition, detailed, false);
    const built = createPersianBuildingRecipe(original, definition, detailed);
    const { parts: originalParts, ...originalAnchors } = original;
    const { garrisonWindows, harborBeacon, parts, ...anchors } = built;
    expect(garrisonWindows?.every(window => [...window.position, window.front].every(Number.isFinite)) ?? true).toBe(true);
    if (definition.id === 39) expect(harborBeacon).toEqual([-1.07, 2.18, -.68]);
    expect(anchors, `${definition.id}/${detailed}/anchors`).toEqual(originalAnchors);
    expect(parts.filter(part => part.stock), `${definition.id}/${detailed}/stocks`)
      .toEqual(originalParts.filter(part => part.stock));
    const before = getRomanRecipeBounds(definition, original), after = getRomanRecipeBounds(definition, built);
    expect(after.extentX, `${definition.id}/${detailed}/x`).toBeLessThanOrEqual(before.extentX + .001);
    expect(after.extentZ, `${definition.id}/${detailed}/z`).toBeLessThanOrEqual(before.extentZ + .001);
    expect(parts.every(part => [...part.position, ...part.size].every(Number.isFinite))).toBe(true);
    expect(parts.every(part => part.size.every(value => value > 0))).toBe(true);
    expect(unsupportedParts(built), `${definition.id}/${detailed}/supported`).toEqual([]);
  }
});

it("keeps Persian worker entrances clear on High and Minimal", () => {
  for (const detailed of [true, false]) for (const definition of BUILDING_CATALOG) {
    if (definition.style === "well" || definition.id === 7) continue;
    const recipe = createPersianBuildingRecipe(createRomanBuildingRecipe(definition, detailed, false),
      definition, detailed);
    const centre = recipe.door[0] + (recipe.doorDimensions?.width ?? .46) / 2;
    const front = recipe.door[2] - .016;
    const blocked = recipe.parts.filter(part => {
      if (part.shape === "stone-arc") return false;
      const { max, min } = getRomanPartBounds(part);
      return min[0] < centre + .31 && max[0] > centre - .31 && min[1] < .82 && max[1] > .025 &&
        min[2] < front + .95 && max[2] > front + .19;
    });
    expect(blocked, `${definition.id}/${detailed}/door`).toEqual([]);
  }
});

it("uses different roof families and a bespoke open-vault palace monument", () => {
  const families = [0, 1, 17, 25].map(id => persianRoofFamily(BUILDING_CATALOG.find(entry => entry.id === id)!));
  expect(new Set(families).size).toBe(4);
  const monument = BUILDING_CATALOG.find(entry => entry.id === 7)!;
  for (const detailed of [true, false]) {
    const recipe = createPersianBuildingRecipe(createRomanBuildingRecipe(monument, detailed, false),
      monument, detailed);
    expect(recipe.parts.some(part => part.shape === "persian-barrel")).toBe(true);
    expect(recipe.parts.filter(part => part.shape === "persian-dome")).toHaveLength(3);
    expect(recipe.parts.some(part => part.shape === "civic-statue")).toBe(false);
    expect(recipe.hideDoor).toBe(true);
  }
});


it("keeps every Persian upgrade decoration physically attached in both quality levels", () => {
  for (const detailed of [true, false]) for (const level of [2, 3, 4, 5] as const)
    for (const definition of BUILDING_CATALOG.filter(entry => entry.id !== 7 && entry.id !== 16))
      expect(unsupportedParts(leveledBuildingRecipe(definition, "persian", detailed, level)),
        `${definition.id}/${detailed}/${level}/supported`).toEqual([]);
});

it("supports the harbour's actual barrel-vault spring feet and the guardhouse flag mast", () => {
  for (const detailed of [true, false]) {
    const harbour = BUILDING_CATALOG.find(entry => entry.id === 39)!;
    const recipe = createPersianBuildingRecipe(createRomanBuildingRecipe(harbour, detailed, false), harbour, detailed);
    for (const vault of recipe.parts.filter(part => part.occupationRoof === "barrel")) {
      const spring = vault.position[1] - vault.size[1] * .44;
      const along = vault.position[0] > .7 ? [-.52, .45] : [vault.position[2]];
      for (const z of along) for (const side of [-1, 1]) {
        const x = vault.position[0] + side * vault.size[0] / 2;
        expect(recipe.parts.some(part => {
          if (part === vault || part.stock || !["plaster", "cut-stone"].includes(part.surface)) return false;
          const bounds = getRomanPartBounds(part);
          return bounds.min[0] <= x && bounds.max[0] >= x && bounds.min[2] <= z && bounds.max[2] >= z &&
            bounds.max[1] >= spring - .005 && bounds.min[1] < spring;
        }), `${detailed}/${x}/${z}/spring`).toBe(true);
      }
    }
    const guard = BUILDING_CATALOG.find(entry => entry.id === 2)!;
    const source = createRomanBuildingRecipe(guard, detailed, false);
    const built = createPersianBuildingRecipe(source, guard, detailed);
    const [x, y, z] = source.flagAnchor!;
    expect(built.parts.some(part => part.surface === "wood" && part.shape === "cylinder" &&
      Math.abs(part.position[0] - x) < .001 && Math.abs(part.position[2] - z) < .001 &&
      Math.abs(getRomanPartBounds(part).max[1] - y) < .001 && getRomanPartBounds(part).min[1] < y - .5)).toBe(true);
  }
});

it("removes rectangular civic roof plates and the old lodge awning from curved rooms", () => {
  for (const detailed of [true, false]) for (const id of [23,57,58,62]) {
    const definition = BUILDING_CATALOG.find(entry => entry.id === id)!;
    const recipe = createPersianBuildingRecipe(createRomanBuildingRecipe(definition, detailed, false),
      definition, detailed);
    expect(recipe.parts.filter(part => !part.stock && part.shape === "box" &&
      ["stone", "cut-stone", "plaster"].includes(part.surface) && part.size[1] <= .10 &&
      part.position[1] > .95 && part.size[0] > .6 && part.size[2] > .6), `${id}/${detailed}/roof plate`).toEqual([]);
    if (id === 62) expect(recipe.parts.filter(part => !part.stock && ["wood", "planks"].includes(part.surface) &&
      part.position[1] > .45), `${detailed}/old porch`).toEqual([]);
  }
});

it("retains one joined annex vault when body upgrades raise only half the inherited roof", () => {
  for (const id of [6,24]) for (const detailed of [true,false]) {
    const definition = BUILDING_CATALOG.find(entry => entry.id === id)!;
    const base = leveledBuildingRecipe(definition, "persian", detailed, 1);
    const upgraded = leveledBuildingRecipe(definition, "persian", detailed, 3);
    const roofs = (recipe: typeof base) => recipe.parts.filter(part => part.shape === "occupation-roof" &&
      part.occupationRoof === "barrel" && part.position[0] > .6);
    expect(roofs(upgraded).length, `${id}/${detailed}/annexes`).toBe(roofs(base).length);
    expect(roofs(upgraded).map(part => part.size), `${id}/${detailed}/vault spans`)
      .toEqual(roofs(base).map(part => part.size));
  }
});
