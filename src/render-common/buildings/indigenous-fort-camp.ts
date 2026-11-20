import type { BuildingRecipe } from "./building-recipe";
import { addIndigenousFortress } from "./indigenous-fortress";
import type { NationBody } from "./nation-kit-classify";
import type { Add } from "./nation-kit-parts";

/** Dedicated fortress authoring; the preceding scaffold camp is retained in the review rollback. */
export const addIndigenousFortCamp = (add: Add, original: BuildingRecipe, body: NationBody, detailed: boolean) => {
  addIndigenousFortress(add, original, body, detailed);
};
