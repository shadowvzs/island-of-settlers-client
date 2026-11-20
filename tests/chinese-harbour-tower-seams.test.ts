import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { BuildingPart } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { CHINESE_TIMBER } from "../src/render-common/buildings/chinese-building-roofs";
import {
  chineseHarbourTowerIntersects, isChineseHarbourTowerCourse
} from "../src/render-common/buildings/chinese-harbour-roof";
import type { BuildingLevel } from "../src/render-common/buildings/levels/building-level";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { ROMAN_HARBOR_BEACON_POSITION } from "../src/render-common/buildings/roman-harbor";
import { HARBOUR_TYPE_ID } from "../src/shared/settlement/building-type-ids";

const [towerX, , towerZ] = ROMAN_HARBOR_BEACON_POSITION;
const TOWER_RADIUS = .44;
const TOWER_BOTTOM = .002, TOWER_TOP = 2.038;
const cases = ([1, 3, 5] as const).flatMap(level => [true, false].map(detailed => [level, detailed] as const));
const recipeOf = (level: BuildingLevel, detailed: boolean) =>
  leveledBuildingRecipe(getBuildingDefinition(HARBOUR_TYPE_ID), "chinese", detailed, level);
const atTower = (part: BuildingPart) =>
  Math.hypot(part.position[0] - towerX, part.position[2] - towerZ) < .02;
const isTimber = (part: BuildingPart) => {
  if (part.stock || part.surface !== "paint" || part.roofSupport || !part.tint) return false;
  if (part.shape !== "cylinder" && part.shape !== "bevel-box") return false;
  return part.tint.every((value, axis) => Math.abs(value - CHINESE_TIMBER[axis]!) < 1e-9);
};

describe.each(cases)("Chinese harbour beacon tower (level %i, detailed %s)", (level, detailed) => {
  const { parts } = recipeOf(level, detailed);

  it("replaces the Roman block courses with one continuous plaster shell", () => {
    expect(parts.filter(isChineseHarbourTowerCourse)).toHaveLength(0);
    const shell = parts.find(part => (part.shape === "ring" || part.shape === "cylinder") && atTower(part) &&
      part.size[1] >= 2 && part.surface === "plaster");
    expect(shell).toBeDefined();
    const bounds = getRomanPartBounds(shell!);
    expect(bounds.min[1]).toBeLessThanOrEqual(TOWER_BOTTOM + .001);
    expect(bounds.max[1]).toBeGreaterThanOrEqual(TOWER_TOP - .001);
    expect(Math.max(shell!.size[0], shell!.size[2]) / 2).toBeLessThanOrEqual(TOWER_RADIUS);
    expect(shell!.topScale?.[0]).toBeGreaterThan(.88);
  });

  it("has no unsupported gap or overlap between stacked tower courses", () => {
    const courses = parts.filter(part => atTower(part) && part.size[1] >= 2 &&
      (part.shape === "ring" || part.shape === "cylinder"));
    expect(courses).toHaveLength(1);
    expect(parts.filter(part => atTower(part) && part.shape === "stone-arc")).toHaveLength(0);
  });

  it("keeps every wall post and corbel bracket outside the tower body", () => {
    const timbers = parts.filter(isTimber);
    expect(timbers.length).toBeGreaterThan(0);
    expect(timbers.filter(chineseHarbourTowerIntersects)).toEqual([]);
  });
});
