import { type TalentModifiers } from "@shared/catalog/balance";

import { BUILDING_LEVEL_STEPS } from "../balance/building-levels";
import { RESIDENCE_POPULATION } from "../balance/population";
import { ownerOf, PLAYER_FACTION } from "./settlement-ownership";
import type { SettlementBuilding } from "./settlement-types";

/** Small, medium and big residence type ids (POP-02). */
export const RESIDENCE_IDS: ReadonlySet<number> = new Set(Object.keys(RESIDENCE_POPULATION).map(Number));

/** People-limit bonus of one residence level: base plus a rounded-up share of the base per level. */
export const residenceLimitBonus = (typeId: number, level: number) => {
  const base = RESIDENCE_POPULATION[typeId]!.limit;
  return base + level * Math.ceil(base * BUILDING_LEVEL_STEPS.populationLimit);
};

/** Seconds per settler of a residence; its upgrade level does not change it (owner 2026-10-20). */
export const residenceGrowthSeconds = (typeId: number) => RESIDENCE_POPULATION[typeId]!.growthSeconds;

/** A completed residence of `owner` (the player by default): it raises that economy's limit and bears settlers. */
export const isActiveResidence = (building: SettlementBuilding, owner = PLAYER_FACTION) =>
  RESIDENCE_IDS.has(building.typeId) && building.construction === 1 && ownerOf(building) === owner;

export const residenceLevel = (building: Pick<SettlementBuilding, "workshopUpgrade">) =>
  building.workshopUpgrade?.level ?? 0;

/** A saved residence timer: a residence's, below its current interval. */
export const validResidenceTimer = (building: SettlementBuilding) =>
  RESIDENCE_IDS.has(building.typeId) && Number.isFinite(building.settlerGrowthTime) &&
  building.settlerGrowthTime! >= 0 &&
  building.settlerGrowthTime! < residenceGrowthSeconds(building.typeId);


type ResidenceTalents = Pick<TalentModifiers, "populationLimit" | "settlerGrowthSpeed">;

/**
 * What one completed residence adds, talent-adjusted like the simulation: its people-limit bonus
 * (the population-limit talent scales the island limit) and the seconds per settler its own timer
 * runs at (the settler-growth talent runs every timer faster). The island limit floors the scaled
 * total, so the per-residence bonus floors the same way.
 */
export const residenceEffect = (
  building: Pick<SettlementBuilding, "typeId" | "workshopUpgrade">, talents: ResidenceTalents
) => ({
  growthSeconds: residenceGrowthSeconds(building.typeId) / (1 + talents.settlerGrowthSpeed),
  limitBonus: Math.floor(
    residenceLimitBonus(building.typeId, residenceLevel(building)) * (1 + talents.populationLimit) + 1e-9)
});
