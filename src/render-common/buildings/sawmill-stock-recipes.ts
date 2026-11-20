import { SAWMILL_RECIPES } from "@shared/catalog/balance";

import type { BuildingRecipe } from "./building-recipe";

/** Mixed recipes share existing bays and contacts; their stock retains its actual material. */
export const withSawmillStockRecipes = (recipe: BuildingRecipe) => {
  for (const part of recipe.parts) {
    const stock = part.stock;
    if (!stock) continue;
    if (stock.kind === "input" && ["log", "logs"].includes(stock.ware))
      part.stock = { ...stock, wares: SAWMILL_RECIPES.map(recipe => recipe.input) };
    if (stock.kind !== "input" && ["plank", "planks"].includes(stock.ware))
      part.stock = { ...stock, wares: SAWMILL_RECIPES.map(recipe => recipe.output) };
  }
  return recipe;
};
