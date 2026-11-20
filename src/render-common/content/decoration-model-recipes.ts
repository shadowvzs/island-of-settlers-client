import { entryByKey, type RecipeId } from "@shared/catalog";

import {
  ALL_ROAD_DECORATIONS, type RoadDecorationDefinition, STAGED_PLANT_DECORATIONS
} from "../../shared/settlement/road-decoration-catalog";
import { entryModelRecipeId } from "./model-recipe-id";

let registry: ReadonlyMap<RecipeId, RoadDecorationDefinition> | undefined;

/** Every decoration model definition (structures and ornamental plants) by its recipe id. */
export const decorationModelRecipes = (): ReadonlyMap<RecipeId, RoadDecorationDefinition> => {
  registry ??= new Map([...ALL_ROAD_DECORATIONS, ...STAGED_PLANT_DECORATIONS]
    .map(definition => [`recipe:decoration.${definition.id}`, definition]));
  return registry;
};

const resolved = new Map<string, RoadDecorationDefinition | undefined>();

/**
 * The model definition a decoration's catalog entry names (`decoration:*` `model.recipe`); undefined for an
 * unknown content id (old saves, foreign maps). Cached per content id.
 */
export const decorationModel = (contentId: string): RoadDecorationDefinition | undefined => {
  if (resolved.has(contentId)) return resolved.get(contentId);
  const entry = entryByKey("decoration", contentId);
  const definition = entry && decorationModelRecipes().get(entryModelRecipeId(entry, {}));
  resolved.set(contentId, definition);
  return definition;
};
