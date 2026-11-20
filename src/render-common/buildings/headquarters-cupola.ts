import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingPart, BuildingRecipe } from "./building-recipe";

/** Roman cupola, statue and upper furnishings stand above this height within this plan radius. */
const CUPOLA_FLOOR = 1.55;
const CUPOLA_RADIUS = 1;

/**
 * Roman HQ cupola (ring floor, colonnade, drum, dome, gilded ornaments, statue and the furnishings
 * on the ring floor); the hall roof and the ladder rungs below the hatch are not part of it.
 */
const isRomanCupola = (part: BuildingPart) => part.position[1] >= CUPOLA_FLOOR &&
  DMath.hypot(part.position[0], part.position[2]) < CUPOLA_RADIUS && part.shape !== "civic-hipped-roof" &&
  !(part.shape === "box" && part.surface === "wood");

/** The Roman HQ without its cupola: nation headquarters crown the hall with their own landmark. */
export const withoutRomanCupola = (recipe: BuildingRecipe): BuildingRecipe =>
  ({ ...recipe, parts: recipe.parts.filter(part => !isRomanCupola(part)) });
