import { entryByKey, type RecipeId } from "@shared/catalog";

import { buildWhaleMesh, type WhaleDetail, type WhaleMesh } from "../whales/whale-model";
import { WHALE_SPECIES, WHALE_SPECIES_NAMES, type WhaleSpecies } from "../whales/whale-species";
import { entryModelRecipeId, registeredModelRecipe } from "./model-recipe-id";

/** The code-built body of a whale species; the renderer chooses the detail (`WHALE_DETAIL`) per preset and size. */
export interface WhaleModelRecipe {
  build: (detail: WhaleDetail) => WhaleMesh;
  species: WhaleSpecies;
}

let registry: ReadonlyMap<RecipeId, WhaleModelRecipe> | undefined;

/** Every whale body by recipe id (`recipe:whale.<key>`). */
export const whaleModelRecipes = (): ReadonlyMap<RecipeId, WhaleModelRecipe> => {
  registry ??= new Map(Object.entries(WHALE_SPECIES).map(([key, species]): [RecipeId, WhaleModelRecipe] =>
    [`recipe:whale.${key}`, { build: detail => buildWhaleMesh(species, detail), species }]));
  return registry;
};

/** The model a whale species' catalog entry names (`whale:*` `model.recipe`). */
export const whaleModelRecipe = (species: WhaleSpecies) => {
  const entry = entryByKey("whale", WHALE_SPECIES_NAMES[species] ?? "");
  return registeredModelRecipe(whaleModelRecipes(), entryModelRecipeId(entry, {}));
};
