import { createWareRecipe } from "../wares/ware-recipe";
import { WORKER_SCALE } from "../workers/worker-dimensions";
import type { BuildingDefinition } from "./building-catalog";
import type { BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds, getRomanRecipeFitScale } from "./building-recipe-fit";

/** Each authored stock slot holds the same original small flour sack carried on a worker's back. */
export const fitRomanFlourStock = (definition: BuildingDefinition, recipe: BuildingRecipe, detailed: boolean) => {
  const slots = recipe.parts.filter(part => part.stock?.ware === "flour");
  if (!slots.length) return;
  const canonical = createWareRecipe("flour", detailed).parts;
  const bottom = Math.min(...canonical.map(part => getRomanPartBounds(part).min[1]));
  const scale = WORKER_SCALE / getRomanRecipeFitScale(definition, recipe);
  const keys = new Set(slots.map(part => `${part.stock!.kind}:${part.stock!.slot}`));
  recipe.parts = recipe.parts.filter(part => part.stock?.ware !== "flour");
  for (const key of keys) {
    const pieces = slots.filter(part => `${part.stock!.kind}:${part.stock!.slot}` === key);
    const bounds = pieces.map(part => getRomanPartBounds(part));
    const minimum = [0, 1, 2].map(axis => Math.min(...bounds.map(bound => bound.min[axis]!)));
    const maximum = [0, 1, 2].map(axis => Math.max(...bounds.map(bound => bound.max[axis]!)));
    const center: Point3 = [(minimum[0]! + maximum[0]!) / 2, minimum[1]! - bottom * scale,
      (minimum[2]! + maximum[2]!) / 2];
    for (const part of canonical) recipe.parts.push({ ...part, stock: pieces[0]!.stock,
      position: part.position.map((value, axis) => center[axis]! + value * scale) as Point3,
      size: part.size.map(value => value * scale) as Point3 });
  }
};
