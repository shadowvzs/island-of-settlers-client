import { describe, expect, it } from "vitest";

import { createBirdBuildingAvoidance } from "../src/render-common/birds/bird-building-avoidance";
import { getBirdBuildingBounds } from "../src/render-common/birds/bird-building-bounds";
import { getBirdRoofPerch, getRoofSlot } from "../src/render-common/birds/bird-roof-perches";
import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import { BUILDING_LEVELS } from "../src/render-common/buildings/levels/building-level";
import { roofTopAt } from "../src/render-common/buildings/levels/level-roof-surface";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { WORKER_NATIONS } from "../src/render-common/workers/worker-appearance";

const BIRD_SIZE = .4;
/** Each case builds every building at one level and nation; the Nubian level-5 escalation alone takes ~10 s. */
const LEVEL_SWEEP_TIMEOUT = 30_000;
const at = (typeId: number, level: number) =>
  ({ rotation: 0, typeId, uid: 1, workshopUpgrade: { level: level - 1 as 0 }, x: 0, y: 0, z: 0 });

const VARIANTS = WORKER_NATIONS.flatMap(nation => BUILDING_LEVELS.map(level => ({ level, nation })));

describe("bird perches and bounds follow the building's level", () => {
  it.each(VARIANTS)("$nation level $level: bounds hold every piece; perched birds sit on top", ({ level, nation }) => {
    for (const definition of BUILDING_CATALOG) {
      const building = { ...at(definition.id, level), nation }, { scale } = getRomanBuildingWorldSizing(definition);
      const bounds = getBirdBuildingBounds(building);
      const recipes = [true, false].map(detailed => ({ detailed, recipe: leveledBuildingRecipe(definition, nation, detailed, level) }));
      const parts = recipes.flatMap(({ recipe }) => recipe.parts.map(part => getRomanPartBounds(part)));
      const top = Math.max(...parts.map(part => part.max[1])) * scale;
      expect(bounds.maxY, `${definition.id} top`).toBeGreaterThanOrEqual(top - 1e-6);
      const roof = getBirdRoofPerch(building, BIRD_SIZE, 1);
      if (!roof) continue;
      const slot = getRoofSlot(roof, 0, 1);
      // Shaped covers leave empty box headroom: measure the rendered surface over the bird's reach.
      const surfaces = recipes.flatMap(({ detailed, recipe }) => {
        const surface = roofTopAt(recipe.parts, slot.x / scale, slot.z / scale, detailed);
        return surface === null ? [] : [surface];
      });
      expect(surfaces.length, `${definition.id} has roof under its perch`).toBeGreaterThan(0);
      const highest = Math.max(...surfaces) * scale;
      expect(highest, `${definition.id} piece through the perched bird`).toBeLessThanOrEqual(roof.surfaceY + .011);
      expect(highest, `${definition.id} perch floats`).toBeGreaterThan(roof.surfaceY - .2);
    }
  }, LEVEL_SWEEP_TIMEOUT);

  it("raised level 3 walls lift the Roman perch and flight bounds", () => {
    const first = getBirdRoofPerch(at(57, 1), BIRD_SIZE, 1)!, third = getBirdRoofPerch(at(57, 3), BIRD_SIZE, 1)!;
    expect(third.surfaceY).toBeGreaterThan(first.surfaceY + .05);
    expect(getBirdBuildingBounds(at(57, 3)).maxY).toBeGreaterThan(getBirdBuildingBounds(at(57, 1)).maxY + .05);
  });

  it("rebuilds the reservations when a building levels up in place or the nation changes", () => {
    const avoidance = createBirdBuildingAvoidance(), building = at(17, 1);
    expect(avoidance.refresh([building])).toBe(true);
    expect(avoidance.refresh([building])).toBe(false);
    building.workshopUpgrade.level = 2 as 0;
    expect(avoidance.refresh([building])).toBe(true);
    const raised = getBirdRoofPerch(building, BIRD_SIZE, 1)!;
    expect(avoidance.roofNear({ x: raised.x + 4, y: raised.y + 2, z: raised.z }, BIRD_SIZE, 1)?.y)
      .toBeCloseTo(raised.y);
    expect(avoidance.refresh([building], "viking")).toBe(true);
    expect(avoidance.refresh([building], "viking")).toBe(false);
  });
});
