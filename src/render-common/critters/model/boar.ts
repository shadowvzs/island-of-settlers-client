import { CRITTER_GLB } from "./critter-glbs";
import type { CritterModel } from "./critter-model";
import { FOOD_CLIPS } from "./quadruped-food";
import { createSkinnedCritterModel } from "./skinned-critter";

/**
 * Wild boar and piglets from the shipped models (assets/models/critters/boar: derived from
 * "Wild Boar Family" by Dakta.Grower.Nzl, CC BY 4.0, rigged and posed by
 * tools/assets/boar-model.ts) in the food critter frames (FOOD_FRAME order), their coats baked
 * into vertex colours. The boar's winter coat is darker and denser; piglets are born in spring
 * and keep their striped coat. Minimal draws about half the triangles.
 */
export const createBoarModel = (minimal: boolean, winter: boolean): CritterModel =>
  createSkinnedCritterModel(CRITTER_GLB.boar, FOOD_CLIPS, { minimal, winter });

export const createPigletModel = (minimal: boolean): CritterModel =>
  createSkinnedCritterModel(CRITTER_GLB.piglet, FOOD_CLIPS, { minimal, winter: false });
