import { MILL_TYPE_ID } from "../../shared/settlement/building-type-ids";
import { WORKER_SCALE } from "../workers/worker-dimensions";
import type { BuildingDefinition } from "./building-catalog";
import type { BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds, getRomanRecipeFitScale } from "./building-recipe-fit";

/** Keep the original carrier-sized wheat bundle grounded in the mill's authored stock bay. */
export const fitRomanMillGrainStock = (definition: BuildingDefinition, recipe: BuildingRecipe) => {
  if (definition.id !== MILL_TYPE_ID) return;
  const parts = recipe.parts.filter(part => part.stock?.ware === "grain");
  if (!parts.length) return;
  const bounds = parts.map(part => getRomanPartBounds(part));
  const minimum = [0, 1, 2].map(axis => Math.min(...bounds.map(bound => bound.min[axis]!)));
  const maximum = [0, 1, 2].map(axis => Math.max(...bounds.map(bound => bound.max[axis]!)));
  const pivot: Point3 = [(minimum[0]! + maximum[0]!) / 2, minimum[1]!,
    (minimum[2]! + maximum[2]!) / 2];
  const ratio = WORKER_SCALE / getRomanRecipeFitScale(definition, recipe);
  for (const part of parts) {
    part.position = part.position.map((value, axis) => pivot[axis]! +
      (value - pivot[axis]!) * ratio) as Point3;
    part.size = part.size.map(value => value * ratio) as Point3;
  }
};
