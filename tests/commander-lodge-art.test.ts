import { describe, expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { getRomanPartBounds, getRomanRecipeBounds } from "../src/render-common/buildings/building-recipe-fit";
import { nationTriangleBudget } from "../src/render-common/buildings/building-triangle-budgets";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import { recipeHeight } from "../src/render-common/buildings/levels/level-site";
import {
  buildingLevelAdditions, leveledBuildingRecipe
} from "../src/render-common/buildings/levels/leveled-building-recipe";
import { COMMANDER_LODGE_CUES } from "../src/render-common/buildings/nation-commander-lodge-designs";
import { createNationBuilding } from "../src/renderers/three/buildings/nation-building";
import { COMMANDER_LODGE_TYPE_ID } from "../src/shared/settlement/building-type-ids";
import { checkTriangleBudget } from "../tools/bench/triangle-budget";
import { createPlainBuildingMaterials, stubPaintCanvas } from "./helpers/building-materials";
import { unsupportedParts } from "./helpers/recipe-supports";

const LODGE = BUILDING_CATALOG.find(definition => definition.id === COMMANDER_LODGE_TYPE_ID)!;
const NATIONS = ["roman", "viking", "nubian", "japanese"] as const;
const LEVELS = [1, 2, 3, 4, 5] as const;
const NATIONAL_SIGNATURE = {
  japanese: "paper-lantern",
  nubian: "nubian-textile",
  roman: "ring",
  viking: "round-shield"
} as const;

describe("national Commander's Lodge art", () => {
  it.each(NATIONS.flatMap(nation => [true, false].map(detailed => ({ detailed, nation }))))(
    "$nation lodge keeps its plot, anchors and supported levels (detail: $detailed)", ({ detailed, nation }) => {
      const base = leveledBuildingRecipe(LODGE, nation, detailed, 1);
      expect(getRomanBuildingWorldSizing(LODGE).cells).toEqual([4, 4]);
      expect(base.door).toEqual([-.18, 0, .591]);
      expect(base.workerExit).toEqual([.05, 0, 1.525]);
      expect(base.workPoint).toEqual([.6975, 0, 1.075]);
      expect(base.doorDimensions).toEqual({ height: .77, spring: .63, width: .46 });
      const baseBounds = getRomanRecipeBounds(LODGE, base), baseHeight = recipeHeight(base.parts);
      for (const level of LEVELS) {
        const recipe = leveledBuildingRecipe(LODGE, nation, detailed, level);
        expect(unsupportedParts(recipe), `${nation}/${detailed}/L${level}`).toEqual([]);
        for (const key of ["door", "doorDimensions", "workerExit", "workPoint", "mechanism",
          "archerPositions", "balconyDoor"] as const) expect(recipe[key]).toEqual(base[key]);
        expect(recipe.parts.filter(part => part.stock)).toEqual(base.parts.filter(part => part.stock));
        const bounds = getRomanRecipeBounds(LODGE, recipe);
        expect(bounds.extentX).toBeLessThanOrEqual(baseBounds.extentX + 1e-3);
        expect(bounds.extentZ).toBeLessThanOrEqual(baseBounds.extentZ + 1e-3);
        expect(recipeHeight(recipe.parts)).toBeLessThanOrEqual(baseHeight * 1.3 + 1e-6);
        if (level === 1) continue;
        const previous = buildingLevelAdditions(LODGE, nation, detailed, level - 1 as 1).length;
        expect(buildingLevelAdditions(LODGE, nation, detailed, level).length, `${nation}/${detailed}/L${level}`)
          .toBeGreaterThan(previous);
        expect(JSON.stringify(recipe.parts)).not.toBe(JSON.stringify(
          leveledBuildingRecipe(LODGE, nation, detailed, level - 1 as 1).parts));
      }
    });

  it.each(NATIONS)("$nation lodge has a national standard, mount bay and mustering yard", nation => {
    const recipe = leveledBuildingRecipe(LODGE, nation, true, 1);
    const near = (part: (typeof recipe.parts)[number], x: number, z: number, radius = .5) =>
      Math.hypot(part.position[0] - x, part.position[2] - z) <= radius;
    expect(recipe.parts.some(part => part.surface === "cloth" && near(part, COMMANDER_LODGE_CUES.standard.x + .2,
      COMMANDER_LODGE_CUES.standard.z, .6))).toBe(true);
    expect(recipe.parts.some(part => part.surface === "hide" && near(part, .72, .02, .4))).toBe(true);
    expect(recipe.parts.some(part => part.surface === "straw" && near(part, 1.12, .27, .4))).toBe(true);
    expect(recipe.parts.some(part => part.surface === "paint" && near(part, 1.2, -.11, .4))).toBe(true);
    expect(recipe.parts.some(part => Math.abs(part.position[2] - COMMANDER_LODGE_CUES.fence.z) < .02 &&
      part.size[0] > .5)).toBe(true);
    expect(recipe.parts.some(part => part.shape === NATIONAL_SIGNATURE[nation])).toBe(true);
  });

  it("does not reuse the removed Stable shell or its stocks for the lodge", () => {
    // The Stable (id 38) has left the building catalog entirely, so only the lodge side remains.
    expect(BUILDING_CATALOG.some(definition => definition.id === 38)).toBe(false);
    for (const nation of NATIONS) for (const detailed of [true, false]) {
      const lodge = leveledBuildingRecipe(LODGE, nation, detailed, 1);
      expect(lodge.parts.filter(part => part.stock)).toEqual([]);
    }
  });

  it.each(NATIONS)("gives %s a distinct national lodge silhouette", nation => {
    const recipe = leveledBuildingRecipe(LODGE, nation, true, 1);
    const roofSurfaces = new Set(recipe.parts.filter(part => part.surface.startsWith("roof")).map(part => part.surface));
    expect(roofSurfaces.size).toBeGreaterThan(0);
    expect(recipe.parts.some(part => part.surface === "plaster" || part.surface === "planks" ||
      part.surface === "bark" || part.surface === "stone" || part.surface === "cut-stone")).toBe(true);
    expect(recipe.parts.length).toBeGreaterThan(60);
  });

  it("keeps every national lodge level inside its High and Minimal triangle budget", () => {
    stubPaintCanvas();
    const materials = createPlainBuildingMaterials();
    for (const nation of NATIONS) for (const detailed of [true, false]) for (const level of LEVELS) {
      const model = createNationBuilding(LODGE, materials, nation, detailed, level);
      const triangles = model.triangles(false);
      model.dispose();
      const budget = nationTriangleBudget(nation, COMMANDER_LODGE_TYPE_ID)[detailed ? 0 : 1];
      expect(checkTriangleBudget(triangles, budget), `${nation}/${detailed ? "high" : "minimal"}/L${level}: ` +
        `${triangles}/${budget}`).toBe("ok");
    }
  });
});

/**
 * Owner 2026-11-09: the Lodge is military, so the Chinese, Persian, Maya and Indigenous lodges
 * (built from their own recipes) carry an original commander's standard: grounded on its stone foot,
 * every piece supported, clear of the hall and its yard at every level, in both details.
 */
describe("expansion nations' Commander's Lodge standard", () => {
  const EXPANSION = ["chinese", "persian", "maya", "indigenous"] as const;
  const { x, z } = COMMANDER_LODGE_CUES.standard;
  /** The standard's own footprint: pole, foot, cloth and its emblem. */
  const inStandard = (part: { position: readonly number[] }) =>
    part.position[0]! >= x - .2 && part.position[0]! <= x + .5 && Math.abs(part.position[2]! - z) <= .2;
  it.each(EXPANSION.flatMap(nation => [true, false].map(detailed => ({ detailed, nation }))))(
    "$nation lodge standard is mounted and free (detail: $detailed)", ({ detailed, nation }) => {
      for (const level of LEVELS) {
        const recipe = leveledBuildingRecipe(LODGE, nation, detailed, level);
        const standard = recipe.parts.filter(inStandard), others = recipe.parts.filter(part => !inStandard(part));
        expect(standard.some(part => part.surface === "cloth" && part.position[1] > .9), `${nation} L${level}`)
          .toBe(true);
        // Only the standard's own pieces: the hall's recipe is judged by its own suites.
        expect(unsupportedParts(recipe).filter(inStandard), `${nation}/${detailed}/L${level}`).toEqual([]);
        const near = others.filter(part => {
          const { max, min } = getRomanPartBounds(part);
          return max[0] > x - .2 && min[0] < x + .45 && max[2] > z - .15 && min[2] < z + .15 && max[1] > .02;
        });
        expect(near.map(part => `${part.shape}/${part.surface}`), `${nation}/${detailed}/L${level}`).toEqual([]);
      }
    });
});
