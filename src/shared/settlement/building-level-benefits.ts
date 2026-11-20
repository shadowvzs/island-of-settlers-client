import { SAWMILL_RECIPES } from "@shared/catalog/balance";

import { type BuildingLevelEffect, MAX_BUILDING_LEVEL } from "../balance/building-levels";
import { STORAGE_BASE_CAPACITY } from "../balance/economy";
import { TERRITORY_RADII } from "../balance/territory";
import { buildingLevelEffects, buildingLevelFamily, levelFactor, levelTerritoryRadius } from "./building-levels";
import { residenceLimitBonus } from "./residences";
import { SECOND_BERTH_LEVEL } from "./settlement-harbour-berths";
import { wareDisplayName } from "./ware-names";

export interface WorkshopUpgradeLevel {
  /** Building level (1 + saved `workshopUpgrade.level`), as the building panel shows it. */
  level: number;
  /** What the building has at this level, in short plain-English phrases (totals, not increments). */
  benefits: readonly string[];
}

const HARBOUR_TYPE_ID = 39;
const EFFECT_NAMES = Object.freeze({
  door: "door strength",
  porterSpeed: "dock porter speed",
  sight: "sight radius",
  training: "recruitment speed",
  workSpeed: "work speed"
});

const percent = (factor: number) => `+${Math.round((factor - 1) * 100)}%`;

const storageBenefit = (typeId: number, savedLevel: number) => {
  const base = STORAGE_BASE_CAPACITY[typeId]!;
  const factor = levelFactor("storage", savedLevel);
  return `${percent(factor)} storage: ${base} → ${Math.round(base * factor)} per ware`;
};
const territoryBenefit = (typeId: number, savedLevel: number) =>
  `${percent(levelFactor("territory", savedLevel))} territory: radius ${TERRITORY_RADII[typeId]} → ` +
  `${levelTerritoryRadius(typeId, savedLevel)}`;
const populationBenefit = (typeId: number, savedLevel: number) =>
  `+${residenceLimitBonus(typeId, savedLevel) - residenceLimitBonus(typeId, 0)} population limit`;
const recipeBenefit = (savedLevel: number) =>
  `Unlocks ${wareDisplayName(SAWMILL_RECIPES[savedLevel]!.output).toLowerCase()}`;

/** One effect's phrase at a saved level (≥ 1). */
const effectBenefit = (typeId: number, effect: BuildingLevelEffect, savedLevel: number) => {
  if (effect === "storage") return storageBenefit(typeId, savedLevel);
  if (effect === "territory") return territoryBenefit(typeId, savedLevel);
  if (effect === "populationLimit") return populationBenefit(typeId, savedLevel);
  if (effect === "sawmillRecipe") return recipeBenefit(savedLevel);
  return `${percent(levelFactor(effect, savedLevel))} ${EFFECT_NAMES[effect]}`;
};

/** What a type has at a building level (1–5); [] at level 1 or for a type without levels. */
export const buildingLevelBenefits = (typeId: number, level: number): readonly string[] => {
  if (!buildingLevelFamily(typeId) || level < 2 || level > MAX_BUILDING_LEVEL) return [];
  const benefits = buildingLevelEffects(typeId).map(effect => effectBenefit(typeId, effect, level - 1));
  return typeId === HARBOUR_TYPE_ID && level >= SECOND_BERTH_LEVEL
    ? [...benefits, "a second berth where the shore allows"] : benefits;
};

/** Every upgrade level (2–5) of a building type with what it gives; [] for a type without levels. */
export const workshopUpgradeLevels = (typeId: number): readonly WorkshopUpgradeLevel[] => {
  if (!buildingLevelFamily(typeId)) return [];
  return Array.from({ length: MAX_BUILDING_LEVEL - 1 }, (_, index) =>
    ({ benefits: buildingLevelBenefits(typeId, index + 2), level: index + 2 }));
};
