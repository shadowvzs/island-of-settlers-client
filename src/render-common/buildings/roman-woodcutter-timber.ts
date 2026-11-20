import { WOODCUTTER_TYPE_ID } from "../../shared/settlement/building-type-ids";
import { createWareRecipe } from "../wares/ware-recipe";
import { TIMBER_LOG_LOWER_RADIUS, TIMBER_LOG_VERTICAL_SPAN } from "../wares/ware-timber-recipe";
import { WORKER_SCALE } from "../workers/worker-dimensions";
import type { BuildingDefinition } from "./building-catalog";
import type { BuildingRecipe } from "./building-recipe";
import { getRomanPartBounds, getRomanRecipeFitScale } from "./building-recipe-fit";

/** Each two-column row rests on the ground or on the actual trunk directly beneath it. */
export const fitRomanWoodcutterTimber = (definition: BuildingDefinition, recipe: BuildingRecipe) => {
  if (definition.id !== WOODCUTTER_TYPE_ID) return;
  const diameter = createWareRecipe("logs", true).parts.find(part => part.surface === "bark")!.size[0];
  const ratio = WORKER_SCALE / getRomanRecipeFitScale(definition, recipe);
  for (let slot = 0; slot < 6; slot++) {
    const parts = recipe.parts.filter(part => part.stock?.ware === "logs" && part.stock.slot === slot);
    if (!parts.length) continue;
    const bottom = Math.min(...parts.map(part => getRomanPartBounds(part).min[1]));
    // Stock placement uses the nominal half-diameter; compensate for the actual bark profile.
    const target = diameter * ratio * (TIMBER_LOG_LOWER_RADIUS - .5 +
      Math.floor(slot / 2) * TIMBER_LOG_VERTICAL_SPAN);
    for (const part of parts) part.position[1] += target - bottom;
  }
};
