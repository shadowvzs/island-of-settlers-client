import { MATERIAL } from "../../shared/world/world-data";
import type { MaterialRecipe } from "./recipe-helpers";
import { lushGrass, meadowGrass, shadedGrass } from "./recipes-meadow";
import { mineGravel } from "./recipes-mine";
import { rock, snow } from "./recipes-rock";
import { dirt, gravel, sand } from "./recipes-soil";

/** Painter per ground material (see recipes-*.ts); every tile is original procedural art. */
export const MATERIAL_RECIPES: Record<number, MaterialRecipe> = {
  [MATERIAL.grass]: meadowGrass,
  [MATERIAL.lushGrass]: lushGrass,
  [MATERIAL.forestFloor]: shadedGrass,
  [MATERIAL.dirt]: dirt,
  [MATERIAL.sand]: sand,
  [MATERIAL.rock]: rock,
  [MATERIAL.snow]: snow,
  [MATERIAL.gravel]: gravel,
  [MATERIAL.mine]: mineGravel
};

/** Normal map strength per material (how bumpy it looks under the sun). */
export const MATERIAL_BUMP: Record<number, number> = {
  [MATERIAL.grass]: 1.6,
  [MATERIAL.lushGrass]: 1.6,
  [MATERIAL.forestFloor]: 1.6,
  [MATERIAL.dirt]: 2.6,
  [MATERIAL.sand]: 1.4,
  [MATERIAL.rock]: 4.5,
  [MATERIAL.snow]: 1.2,
  [MATERIAL.gravel]: 2.8,
  [MATERIAL.mine]: 2.6
};
