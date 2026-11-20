import { buildingEntry, type RecipeId } from "@shared/catalog";

import { NATIONS } from "../../../../island-of-settlers-shared/src/nations";
import { BUILDING_CATALOG } from "../buildings/building-catalog";
import { BUILDING_LEVELS, type BuildingLevel } from "../buildings/levels/building-level";
import { MONUMENT_TYPE_ID } from "../buildings/monument-definition";
import { isBuildingFirstNation, type SettlerNation, type WorkerNation } from "../workers/worker-nation";
import { entryModelRecipeId, registeredModelRecipe } from "./model-recipe-id";

/**
 * How one building model is made: the leveled recipe (`levels/leveled-building-recipe.ts`) of a nation, or the
 * authored monument GLB (`renderers/three/buildings/monument-building.ts`). `level` is absent for buildings without
 * level art (the monument): the requested level then passes through to the recipe unchanged.
 */
export type BuildingModelRecipe =
  | { kind: "authored"; nation: SettlerNation }
  | { kind: "leveled"; level?: BuildingLevel; nation: WorkerNation };

const keyOf = (type: number) => {
  const key = buildingEntry(type)?.key;
  if (!key) throw new Error(`Building ${type} has no content entry`);
  return key;
};

const monumentRecipe = (nation: WorkerNation): BuildingModelRecipe =>
  isBuildingFirstNation(nation) ? { kind: "leveled", nation } : { kind: "authored", nation };

const registerBuilding = (recipes: Map<RecipeId, BuildingModelRecipe>, type: number) => {
  const key = keyOf(type);
  for (const nation of NATIONS) {
    if (type === MONUMENT_TYPE_ID) {
      recipes.set(`recipe:building.${key}.${nation}`, monumentRecipe(nation));
      continue;
    }
    for (const level of BUILDING_LEVELS)
      recipes.set(`recipe:building.${key}.${nation}.level${level}`, { kind: "leveled", level, nation });
  }
};

let registry: ReadonlyMap<RecipeId, BuildingModelRecipe> | undefined;

/** Every building model the client can build: each player building of each nation at each level. */
export const buildingModelRecipes = (): ReadonlyMap<RecipeId, BuildingModelRecipe> => {
  if (registry) return registry;
  const recipes = new Map<RecipeId, BuildingModelRecipe>();
  for (const { id } of BUILDING_CATALOG) registerBuilding(recipes, id);
  registry = recipes;
  return registry;
};

/** The model recipe a building's catalog entry names for a nation and level (`building:*` `model.recipe`). */
export const buildingModelRecipe = (type: number, nation: WorkerNation, level: BuildingLevel) =>
  registeredModelRecipe(buildingModelRecipes(), entryModelRecipeId(buildingEntry(type), { level, nation }));
