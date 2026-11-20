import type { SettlementBuilding } from "../../shared/settlement/settlement-types";
import { type BuildingDefinition, getBuildingDefinition } from "../buildings/building-catalog";
import type { BuildingRecipe } from "../buildings/building-recipe";
import { type BuildingLevel, buildingLevelOf } from "../buildings/levels/building-level";
import { leveledBuildingRecipe } from "../buildings/levels/leveled-building-recipe";
import { PLAYER_NATIONS } from "../workers/worker-appearance";
import type { WorkerNation } from "../workers/worker-unit";

export type BirdBuilding = Pick<
  SettlementBuilding,
  "uid" | "typeId" | "x" | "y" | "z" | "rotation"
> &
  Partial<Pick<SettlementBuilding, "construction" | "workshopUpgrade">> &
  { /** The architecture it is drawn in (the settlement's nation); Roman when absent. */ nation?: WorkerNation };

/** The rendered model a bird meets: the building's type at its current level, in the settlement's nation. */
export interface BirdBuildingModel {
  definition: BuildingDefinition;
  /** Detailed (High) and Minimal recipes: flight reservations cover both. */
  recipes: readonly [BuildingRecipe, BuildingRecipe];
}

export const birdBuildingLevel = (building: BirdBuilding): BuildingLevel =>
  buildingLevelOf(building.workshopUpgrade?.level);

export const birdBuildingNation = (building: BirdBuilding): WorkerNation => building.nation ?? "roman";

/** Numeric cache key per (type, nation, level), so per-frame lookups allocate nothing. */
export const birdModelKey = (typeId: number, nation: WorkerNation, level: BuildingLevel) =>
  (typeId * PLAYER_NATIONS.length + PLAYER_NATIONS.indexOf(nation)) * 8 + level;

export const getBirdBuildingModel = (
  typeId: number,
  nation: WorkerNation,
  level: BuildingLevel
): BirdBuildingModel => {
  const definition = getBuildingDefinition(typeId);
  return {
    definition,
    recipes: [
      leveledBuildingRecipe(definition, nation, true, level),
      leveledBuildingRecipe(definition, nation, false, level)
    ]
  };
};
