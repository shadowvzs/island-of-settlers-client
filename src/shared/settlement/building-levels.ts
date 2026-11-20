import { buildingRules } from "@shared/catalog/building-data/rules";

import {
  BUILDING_LEVEL_STEPS, type BuildingLevelEffect, type BuildingLevelFamily, type BuildingLevelStep,
  MAX_SAVED_BUILDING_LEVEL
} from "../balance/building-levels";
import { TERRITORY_RADII } from "../balance/territory";
import type { Goods } from "./settlement-types";

/** The rules sidecar's `levels` block of a type; undefined for a type without levels. */
const levels = (typeId: number) => buildingRules(typeId)?.levels;

/** The upgrade family of a building type; undefined for a type without levels. */
export const buildingLevelFamily = (typeId: number) => levels(typeId)?.family as BuildingLevelFamily | undefined;
export const hasBuildingLevels = (typeId: number) => levels(typeId) !== undefined;
/** Highest saved upgrade level of a type: 4 (building level 5) for every upgradeable type, else 0. */
export const maxSavedBuildingLevel = (typeId: number) => hasBuildingLevels(typeId) ? MAX_SAVED_BUILDING_LEVEL : 0;

/** The effects every level of a type adds; [] for a type without levels. */
export const buildingLevelEffects = (typeId: number): readonly BuildingLevelEffect[] =>
  (levels(typeId)?.effects ?? []) as readonly BuildingLevelEffect[];

export const hasLevelEffect = (typeId: number, effect: BuildingLevelEffect) =>
  buildingLevelEffects(typeId).includes(effect);
/** Bonus share of an effect at a saved level (work speed level 2 → 0.1, level 5 → 0.4). */
export const levelShare = (step: BuildingLevelStep, savedLevel: number) =>
  BUILDING_LEVEL_STEPS[step] * Math.max(0, savedLevel);
/** Multiplier of an effect at a saved level: 1 + step × level. */
export const levelFactor = (step: BuildingLevelStep, savedLevel: number) => 1 + levelShare(step, savedLevel);

/** Claimed radius of a type at a saved level; only military types grow theirs. */
export const levelTerritoryRadius = (typeId: number, savedLevel: number) => {
  const base = TERRITORY_RADII[typeId];
  if (base === undefined || !hasLevelEffect(typeId, "territory")) return base;
  return Math.round(base * levelFactor("territory", savedLevel));
};

/**
 * Wood and stone of the upgrade from `savedLevel` to the next level (rules sidecar `levels.costs`): the next
 * level's colony resource tier pair, in the family's wood form; {} at the maximum or for a type without levels.
 */
export const buildingLevelCost = (typeId: number, savedLevel: number): Goods => ({
  ...levels(typeId)?.costs[savedLevel]
});
