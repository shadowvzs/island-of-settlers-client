import { entryByKey, type RecipeId } from "@shared/catalog";

import { NATIONS } from "../../../../island-of-settlers-shared/src/nations";
import type { ShipLivery } from "../ships/ship-frame";
import type { WorkerNation } from "../workers/worker-nation";
import { entryModelRecipeId, registeredModelRecipe } from "./model-recipe-id";

/** A sailing hull style: one per nation and the raiders' galley (`renderers/three/settlement/ship-styles.ts`). */
export type ShipStyle = WorkerNation | "raider";

/** The sailing ship hull and rig of a style (`SHIP_STYLES`). */
export interface ShipModelRecipe {
  kind: "ship";
  style: ShipStyle;
}

/**
 * The nation's harbour-boat hull (`national-harbour-boat.ts`): the shuttle lighter as built, the fishing skiff
 * scaled to the skiff dimensions (`three-fishing-boats.ts`).
 */
export interface BoatModelRecipe {
  kind: "fishingSkiff" | "lighter";
  nation: WorkerNation;
}

/**
 * How one ship or boat model is made. Liveries (player, neutral, enemy cloth and figurehead) and detail are
 * builder inputs, not separate recipes.
 */
export type VesselModelRecipe = BoatModelRecipe | ShipModelRecipe;

type BoatKey = "fishingSkiff" | "lighter";

const registerNation = (recipes: Map<RecipeId, VesselModelRecipe>, nation: WorkerNation) => {
  recipes.set(`recipe:ship.sailingShip.${nation}`, { kind: "ship", style: nation });
  recipes.set(`recipe:boat.fishingSkiff.${nation}`, { kind: "fishingSkiff", nation });
  recipes.set(`recipe:boat.lighter.${nation}`, { kind: "lighter", nation });
};

let registry: ReadonlyMap<RecipeId, VesselModelRecipe> | undefined;

/** Every ship and boat model the client can build: each nation's hulls and the raiders' galley. */
export const vesselModelRecipes = (): ReadonlyMap<RecipeId, VesselModelRecipe> => {
  if (registry) return registry;
  const recipes = new Map<RecipeId, VesselModelRecipe>([["recipe:ship.raider", { kind: "ship", style: "raider" }]]);
  for (const nation of NATIONS) registerNation(recipes, nation);
  registry = recipes;
  return registry;
};

/** Resolved recipes by `<kind>.<key>.<nation>`: frames ask every update, the catalog template is filled once. */
const resolved = new Map<string, VesselModelRecipe>();

const vesselModelRecipe = (kind: "boat" | "ship", key: string, nation: WorkerNation) => {
  const cacheKey = `${kind}.${key}.${nation}`;
  let recipe = resolved.get(cacheKey);
  if (recipe) return recipe;
  recipe = registeredModelRecipe(vesselModelRecipes(), entryModelRecipeId(entryByKey(kind, key), { nation }));
  resolved.set(cacheKey, recipe);
  return recipe;
};

const shipRecipe = (key: string, nation: WorkerNation): ShipModelRecipe => {
  const recipe = vesselModelRecipe("ship", key, nation);
  if (recipe.kind !== "ship") throw new Error(`Ship ${key} names a boat model recipe`);
  return recipe;
};

/**
 * The model a ship frame draws (`ship:*` `model.recipe`). Raiders (enemy livery) sail their own galley; neutral
 * traders use their assigned nation's hull; the player's ships and construction sites use the player's nation.
 */
export const shipModelRecipe = (livery?: ShipLivery, nation: WorkerNation = "roman",
  traderNation?: WorkerNation): ShipModelRecipe => {
  if (livery === "enemy") return shipRecipe("raider", nation);
  if (livery === "neutral") return shipRecipe("sailingShip", traderNation ?? "roman");
  return shipRecipe("sailingShip", nation);
};

/** The model of a nation's boat (`boat:*` `model.recipe`). */
export const boatModelRecipe = (key: BoatKey, nation: WorkerNation): BoatModelRecipe => {
  const recipe = vesselModelRecipe("boat", key, nation);
  if (recipe.kind === "ship") throw new Error(`Boat ${key} names a ship model recipe`);
  return recipe;
};
