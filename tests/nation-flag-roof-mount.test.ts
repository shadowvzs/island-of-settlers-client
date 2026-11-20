import { expect, it } from "vitest";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { createNationKitRecipe } from "../src/render-common/buildings/nation-architecture-kit";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { withRoofFlagMount } from "../src/render-common/buildings/nation-flag-roof-mount";
import { roofTopAt } from "../src/render-common/buildings/levels/level-roof-surface";
import { unsupportedParts } from "./helpers/recipe-supports";

it.each([true, false])("attaches Japanese guardhouse flag to the actual roof profile (detail:%s)", detailed => {
  const definition = getBuildingDefinition(2);
  const original = createNationKitRecipe(createRomanBuildingRecipe(definition, detailed, false), definition,
    "japanese", detailed);
  const built = withRoofFlagMount(original, detailed);
  const { parts: oldParts, ...before } = original, { parts, ...after } = built;
  expect(after).toEqual(before);
  expect(parts.filter(part => part.stock)).toEqual(oldParts.filter(part => part.stock));
  const [x, y, z] = original.flagAnchor!, roof = roofTopAt(oldParts, x, z, detailed)!;
  expect(y - .20 - roof).toBeGreaterThan(.4);
  const added = parts.slice(oldParts.length);
  const mast = added.find(part => part.surface === "wood" && part.size[1] > .3)!;
  expect(mast).toBeDefined();
  expect(mast.position[0]).toBe(x); expect(mast.position[2]).toBe(z);
  expect(getRomanPartBounds(mast).min[1]).toBeLessThan(roof);
  expect(getRomanPartBounds(mast).max[1]).toBeGreaterThan(y - .20);
  expect(added.every(part => getRomanPartBounds(part).min[1] > .85)).toBe(true);
  expect(unsupportedParts(built)).toEqual([]);
  expect(withRoofFlagMount(built, detailed)).toBe(built);
  expect(unsupportedParts(createNationBuildingRecipe(definition, "japanese", detailed))).toEqual([]);
});


it("uses a real horizontal masonry cap when a terrace has no roof-skin tag", () => {
  const source = createRomanBuildingRecipe(getBuildingDefinition(2), true, false);
  const [x, , z] = source.flagAnchor!;
  const flat = { ...source, parts: [{ position: [x, 1.2, z] as [number, number, number],
    size: [.5, .08, .5] as [number, number, number], shape: "box" as const,
    surface: "plaster" as const, stage: 1 },
    { position: [x, .6, z] as [number, number, number], size: [.1, 1.2, .1] as [number, number, number],
      shape: "box" as const, surface: "plaster" as const, stage: 1 }] };
  const mounted = withRoofFlagMount(flat, true);
  expect(mounted.parts.length).toBeGreaterThan(flat.parts.length);
  expect(mounted.flagAnchor).toEqual(source.flagAnchor);
  expect(unsupportedParts(mounted)).toEqual(unsupportedParts(flat));
});
