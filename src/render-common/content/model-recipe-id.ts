import { type ContentEntry, modelRecipeId, type PathTokenValues, type RecipeId } from "@shared/catalog";

/**
 * The concrete recipe id of a catalog entry instance. The catalog names the model (`model.recipe`, template
 * tokens filled from `values`); a client registry maps the id to the code that builds it.
 */
export const entryModelRecipeId = (entry: ContentEntry | undefined, values: PathTokenValues): RecipeId => {
  const id = entry && modelRecipeId(entry, { code: entry.code ?? "", key: entry.key, ...values });
  if (!id) throw new Error(`Content entry ${entry?.id ?? "(unknown)"} names no model recipe`);
  return id;
};

/** A registry lookup that fails loudly: a catalog id without registered code is a content bug. */
export const registeredModelRecipe = <T>(registry: ReadonlyMap<RecipeId, T>, id: RecipeId): T => {
  const recipe = registry.get(id);
  if (recipe === undefined) throw new Error(`Model recipe ${id} is not registered`);
  return recipe;
};
