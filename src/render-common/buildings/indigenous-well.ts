import type { BuildingRecipe } from "./building-recipe";
import { indigenousOpenWellParts } from "./indigenous-well-parts";

/** Gathered boulders surround an open working windlass; a textile roof belongs to later upgrades. */
export const indigenousWellRecipe = (original: BuildingRecipe, detailed: boolean): BuildingRecipe =>
  ({ ...original, parts: indigenousOpenWellParts(original, detailed) });
