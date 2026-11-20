import type { RecipeId } from "@shared/catalog";

import { buildingModelRecipes } from "./building-model-recipes";
import { decorationModelRecipes } from "./decoration-model-recipes";
import { lifeModelRecipes } from "./life-model-recipes";
import { propModelRecipes } from "./prop-model-recipes";
import { vesselModelRecipes } from "./vessel-model-recipes";
import { whaleModelRecipes } from "./whale-model-recipes";

/**
 * The client model recipe registry: catalog entries name their model by `recipe:<kind>.<key>[.<nation>][.level<n>]`
 * and one family registry maps each id to the code that builds it. Consumers import their family module only (the
 * families pull very different code); this index serves the coverage test and the asset tools.
 */
export const MODEL_RECIPE_FAMILIES: Readonly<Record<string, () => ReadonlyMap<RecipeId, unknown>>> = {
  building: buildingModelRecipes,
  decoration: decorationModelRecipes,
  life: lifeModelRecipes,
  prop: propModelRecipes,
  vessel: vesselModelRecipes,
  whale: whaleModelRecipes
};

/** Every registered model recipe id of every family. */
export const registeredModelRecipeIds = (): ReadonlySet<RecipeId> =>
  new Set(Object.values(MODEL_RECIPE_FAMILIES).flatMap(family => [...family().keys()]));
