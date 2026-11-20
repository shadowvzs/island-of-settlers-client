import { CRITTER_GLB } from "./critter-glbs";
import type { CritterModel } from "./critter-model";
import { FOOD_CLIPS } from "./quadruped-food";
import { createSkinnedCritterModel } from "./skinned-critter";

/**
 * Chamois from the shipped model (assets/models/critters/chamois: derived from "Antelope" by
 * planeta-elefante, CC BY 4.0, built by tools/assets/chamois-model.ts): the source's idle,
 * walk, run, graze and death clips baked into the food critter frames (FOOD_FRAME order),
 * chamois anatomy, summer (tawny) and winter (dark brown-black) coats. High detail draws every
 * triangle, Minimal about half; the kid is the same animal without horns (its species scales it).
 */

/** Which chamois to build: the season's coat, the detail level and the kid (no horns). */
export interface ChamoisOptions {
  kid: boolean;
  minimal: boolean;
  winter: boolean;
}

export const createChamoisModel = ({ kid, minimal, winter }: ChamoisOptions): CritterModel =>
  createSkinnedCritterModel(CRITTER_GLB.chamois, FOOD_CLIPS, { minimal, winter, withoutPart: kid });
