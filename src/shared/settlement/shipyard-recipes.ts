import { buildingRules } from "@shared/catalog/building-data/rules";

import { SHIPYARD_TYPE_ID } from "./building-type-ids";

export type ShipyardMode = "boats" | "ships";
const SHIPYARD_MODES = buildingRules(SHIPYARD_TYPE_ID)!.production!.modes!;
const modeRecipe = (mode: ShipyardMode) => {
  const { inputs } = SHIPYARD_MODES[mode]!;
  return Object.freeze({ cloth: inputs.cloth ?? 0, planks: inputs.planks ?? 0 });
};

/**
 * Canonical Shipyard material recipes by selected mode (FLAX-CLOTH-SHIPS-01; the shipyard rules sidecar
 * `production.modes`, which also name what each mode builds). Boats remain a single-plank workshop product; a sea
 * ship consumes ten hull planks and four cloth rolls fitted before rigging completes. UI, demand, native work and
 * validation all read these amounts instead of duplicating tooltip literals.
 */
export const SHIPYARD_RECIPES: Readonly<Record<ShipyardMode, Readonly<{ cloth: number; planks: number }>>> =
  Object.freeze({ boats: modeRecipe("boats"), ships: modeRecipe("ships") });
/** Hull planks fitted before the cloth rigging visits begin; the last planks finish the fairing. */
export const SHIPYARD_HULL_PLANKS_BEFORE_RIGGING =
  Math.max(0, SHIPYARD_RECIPES.ships.planks - 2);
/** The mast/rigging appears once this many of the required cloth rolls are fitted. */
export const SHIPYARD_MAST_CLOTH = Math.ceil(SHIPYARD_RECIPES.ships.cloth / 2);
/** The mode's material recipe; unknown modes fall back to boats without inventing a cost. */
export const shipyardRecipe = (mode: string | undefined) =>
  mode === "ships" ? SHIPYARD_RECIPES.ships : SHIPYARD_RECIPES.boats;
/** Every material line of a mode, repeated once per required unit for production-rule inputs. */
export const shipyardRecipeInputs = (mode: string | undefined) => {
  const recipe = shipyardRecipe(mode);
  return [
    ...Array.from({ length: recipe.planks }, () => "planks"),
    ...Array.from({ length: recipe.cloth }, () => "cloth")
  ];
};
/** A sea ship may launch only after every hull plank and all four cloth rolls are consumed. */
export const seaShipReady = (planks: number, cloth: number) =>
  planks >= SHIPYARD_RECIPES.ships.planks && cloth >= SHIPYARD_RECIPES.ships.cloth;
