import { SAWMILL_RECIPES } from "@shared/catalog/balance";

import type { ProductionRule, SettlementBuilding } from "./settlement-types";

export type SawmillRecipeBuilding = Pick<SettlementBuilding, "typeId" | "workshopUpgrade" | "selectedOutput">;
export const unlockedSawmillRecipes = (building: Pick<SettlementBuilding, "workshopUpgrade">) =>
  SAWMILL_RECIPES.slice(0, Math.min(5, 1 + (building.workshopUpgrade?.level ?? 0)));
export const selectedSawmillRecipe = (building: SawmillRecipeBuilding) =>
  unlockedSawmillRecipes(building).find(recipe => recipe.output === building.selectedOutput) ?? SAWMILL_RECIPES[0]!;
export const sawmillProductionRule = (building: SawmillRecipeBuilding, base: ProductionRule): ProductionRule => {
  if (building.typeId !== 33) return base;
  const recipe = selectedSawmillRecipe(building);
  return { ...base, inputs: [recipe.input], outputs: [recipe.output] };
};
