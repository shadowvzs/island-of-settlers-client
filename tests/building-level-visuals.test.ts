import { describe, expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import type { BuildingPart, Point3 } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds, getRomanRecipeBounds } from "../src/render-common/buildings/building-recipe-fit";
import { buildingLevelOf, upgradedBuildingLevel } from "../src/render-common/buildings/levels/building-level";
import { recipeHeight } from "../src/render-common/buildings/levels/level-site";
import { CANOPY } from "../src/render-common/buildings/levels/level-wall-pieces";
import {
  buildingLevelAdditions, leveledBuildingRecipe
} from "../src/render-common/buildings/levels/leveled-building-recipe";
import { unsupportedParts } from "./helpers/recipe-supports";

const NATIONS = ["roman", "viking", "nubian", "japanese"] as const;
/** Monument (63) is a unique wonder with no level progression. */
const LEVELED_CATALOG = BUILDING_CATALOG.filter(definition => definition.id !== 7);
/** Level 2 (dressing, original height) and level 5 (raised walls and every addition) cover all parts. */
const VARIANTS = NATIONS.flatMap(nation => LEVELED_CATALOG.flatMap(definition => [true, false].flatMap(detailed =>
  ([2, 5] as const).map(level => ({ definition, detailed, level, name: definition.name, nation })))));

/** The side canopy's thin roof slab; its pitch tells which way its wall face points. */
const CANOPY_SLAB = .035;
const canopyNormal = (part: BuildingPart): Point3 | null => {
  if (part.shape !== "box" || part.stage !== 4 || (part.surface !== "roof" && part.surface !== "straw")) return null;
  const wide = Math.abs(part.size[0] - CANOPY.size[0]) < 1e-6 || Math.abs(part.size[2] - CANOPY.size[0]) < 1e-6;
  if (!wide || Math.abs(part.size[1] - CANOPY_SLAB) > 1e-6) return null;
  // An x pitch is a z-facing wall (its sign is outward), a z pitch an x-facing wall (the opposite sign).
  if (part.rotation?.[0]) return [0, 0, Math.sign(part.rotation[0])];
  if (part.rotation?.[2]) return [-Math.sign(part.rotation[2]), 0, 0];
  return null;
};

/** The round-tower lantern's 0.22-long iron arm; its yaw is the bearing out of the tower. */
const shaftLanternNormal = (part: BuildingPart): Point3 | null => {
  if (part.shape !== "box" || part.surface !== "iron" || !part.rotation?.[1] ||
    Math.abs(part.size[0] - .22) > 1e-6 || Math.abs(part.size[1] - .022) > 1e-6 ||
    Math.abs(part.size[2] - .022) > 1e-6) return null;
  const bearing = -part.rotation[1];
  return [Math.cos(bearing), 0, Math.sin(bearing)];
};

/** The worker corridor in front of the door (as in building-entrances.test.ts). */
const blocksDoorway = (part: BuildingPart, door: { centre: number; front: number; top: number }) => {
  const { max, min } = getRomanPartBounds(part);
  const corridor = { max: [door.centre + .31, .82, door.front + .95], min: [door.centre - .31, .025, door.front + .19] };
  return [0, 1, 2].every(axis => min[axis]! < corridor.max[axis]! && max[axis]! > corridor.min[axis]!);
};

describe("building level art", () => {
  it("maps saved upgrade levels to panel levels 1-5", () => {
    expect([0, 1, 2, 3, 4, 9].map(level => buildingLevelOf(level))).toEqual([1, 2, 3, 4, 5, 5]);
    expect(upgradedBuildingLevel(0)).toBeUndefined();
    expect(upgradedBuildingLevel(2)).toBe(3);
  });

  it.each(VARIANTS)("$nation $name level $level (detail: $detailed) keeps its contracts",
    ({ definition, detailed, level, nation }) => {
      const base = leveledBuildingRecipe(definition, nation, detailed, 1);
      const recipe = leveledBuildingRecipe(definition, nation, detailed, level);
      expect(unsupportedParts(recipe)).toEqual([]);
      // Door, anchors and stock displays are the level 1 ones.
      for (const key of ["door", "doorDimensions", "workerExit", "workPoint", "mechanism", "archerPositions",
        "balconyDoor"] as const) expect(recipe[key]).toEqual(base[key]);
      expect(recipe.parts.filter(part => part.stock)).toEqual(base.parts.filter(part => part.stock));
      // Plot envelope and the 130 % height cap.
      const bounds = getRomanRecipeBounds(definition, recipe), original = getRomanRecipeBounds(definition, base);
      expect(bounds.extentX).toBeLessThanOrEqual(original.extentX + 1e-3);
      expect(bounds.extentZ).toBeLessThanOrEqual(original.extentZ + 1e-3);
      expect(recipeHeight(recipe.parts)).toBeLessThanOrEqual(recipeHeight(base.parts) * 1.3 + 1e-6);
      // No addition stands in the door lane.
      const door = { centre: base.door[0] + (base.doorDimensions?.width ?? .46) / 2, front: base.door[2] - .016,
        top: base.doorDimensions?.height ?? .77 };
      if (definition.style !== "well") expect(buildingLevelAdditions(definition, nation, detailed, level)
        .filter(part => blocksDoorway(part, door)).map(part => part.position)).toEqual([]);
    });

  it.each(NATIONS.flatMap(nation => [true, false].map(detailed => ({ detailed, nation }))))(
    "every $nation ordinary building keeps distinct lower-level architecture (detail: $detailed)", ({ detailed, nation }) => {
      const missing: string[] = [];
      for (const definition of LEVELED_CATALOG) for (const level of [2, 3, 4] as const) {
        const added = buildingLevelAdditions(definition, nation, detailed, level).length -
          buildingLevelAdditions(definition, nation, detailed, level - 1 as 1).length;
        const key = `${nation}/${detailed ? "high" : "minimal"}/${definition.id}/${level}`;
        // The fixed catapult shell has no architectural upgrade; its old changes were generic banners.
        if (added <= 0 && definition.id !== 16) missing.push(key);
      }
      expect(missing).toEqual([]);
    });

  it("does not fill Viking mine final upgrades with a generic hanging-circle banner", () => {
    for (const definition of BUILDING_CATALOG.filter(definition => [10, 11, 12, 13].includes(definition.id))) {
      const added = buildingLevelAdditions(definition, "viking", false, 5);
      expect(added.filter(part => part.surface === "cloth"), definition.name).toEqual([]);
    }
  });

  it("places side canopies and round-tower lanterns on the camera side", () => {
    const canopies: Array<{ key: string; normal: Point3 }> = [];
    const lanterns: Array<{ key: string; normal: Point3 }> = [];
    for (const nation of NATIONS) for (const detailed of [true, false]) for (const definition of LEVELED_CATALOG) {
      const key = `${nation}/${detailed ? "high" : "minimal"}/${definition.id}`;
      for (const part of buildingLevelAdditions(definition, nation, detailed, 4)) {
        const canopy = canopyNormal(part), lantern = shaftLanternNormal(part);
        if (canopy) canopies.push({ key, normal: canopy });
        if (lantern) lanterns.push({ key, normal: lantern });
      }
    }
    expect(canopies.length, "side canopy coverage").toBeGreaterThan(0);
    expect(lanterns.length, "round-tower lantern coverage").toBeGreaterThan(0);
    for (const { key, normal } of [...canopies, ...lanterns])
      expect(normal[0] + normal[2], key).toBeGreaterThan(0);
  });

  it("caches one recipe per type, nation, level and detail", () => {
    const definition = BUILDING_CATALOG[0]!;
    expect(leveledBuildingRecipe(definition, "viking", true, 4)).toBe(leveledBuildingRecipe(definition, "viking", true, 4));
    expect(leveledBuildingRecipe(definition, "viking", false, 4)).not.toBe(leveledBuildingRecipe(definition, "viking", true, 4));
  });

  it.each(NATIONS)("keeps %s final upgrade stock and archer stations intact without filler banners", nation => {
    for (const definition of LEVELED_CATALOG) for (const detailed of [true, false]) {
      const fourth = leveledBuildingRecipe(definition, nation, detailed, 4);
      const fifth = leveledBuildingRecipe(definition, nation, detailed, 5);
      expect(fifth.parts.filter(part => part.stock)).toEqual(fourth.parts.filter(part => part.stock));
      expect(fifth.archerPositions).toEqual(fourth.archerPositions);
    }
    // Level five may retain level-four architecture where a generic banner was its only addition.
  });
});
