import { createWareRecipe } from "../wares/ware-recipe";
import { TIMBER_LOG_LOWER_RADIUS } from "../wares/ware-timber-recipe";
import { WORKER_SCALE } from "../workers/worker-dimensions";
import type { BuildingDefinition } from "./building-catalog";
import type { BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanRecipeFitScale } from "./building-recipe-fit";

/** The saw cuts the same original trunk delivered by carriers, resting on its existing feed table. */
export const fitRomanSawmillTimber = (definition: BuildingDefinition, recipe: BuildingRecipe, detailed: boolean) => {
  if (definition.id !== 33) return;
  const timber = recipe.parts.find(part => !part.stock && part.surface === "bark" && part.shape === "cylinder");
  if (!timber) return;
  const [x, , z] = timber.position;
  const table = recipe.parts.find(part => part.surface === "wood" && part.stage === 2 &&
    Math.abs(part.position[0] - x) < .001 && Math.abs(part.position[2] - z) < .001 &&
    Math.abs(part.size[1] - .065) < .001);
  if (!table) return;
  const ratio = WORKER_SCALE / getRomanRecipeFitScale(definition, recipe);
  const canonical = createWareRecipe("logs", detailed).parts;
  const body = canonical.find(part => part.surface === "bark")!;
  const center: Point3 = [x, table.position[1] + table.size[1] / 2 +
    body.size[0] * ratio * TIMBER_LOG_LOWER_RADIUS, z];
  recipe.parts = recipe.parts.filter(part => !(!part.stock &&
    (part.surface === "bark" || part.surface === "endgrain") &&
    Math.abs(part.position[0] - x) <= timber.size[0] * .55 &&
    Math.abs(part.position[1] - timber.position[1]) <= timber.size[0] * .55 &&
    Math.abs(part.position[2] - z) <= timber.size[1] * .55));
  for (const part of canonical) recipe.parts.push({ ...part,
    workyardAssembly: "equipment-33",
    position: part.position.map((value, axis) => center[axis]! + value * ratio) as Point3,
    size: part.size.map(value => value * ratio) as Point3 });
};
