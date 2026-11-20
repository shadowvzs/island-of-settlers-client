import { PRODUCTION_RULES } from "../../shared/settlement/production-rules";
import { createWareRecipe } from "../wares/ware-recipe";
import type { BuildingDefinition } from "./building-catalog";
import type { BuildingPart, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";

/** Fill missing ware categories beside the existing yard, without touching authored workshop props. */
export const addMissingRomanProductionStocks = (definition: BuildingDefinition, parts: BuildingPart[], detailed: boolean) => {
  const rule = PRODUCTION_RULES[definition.id];
  if (!rule || rule.service) return;
  const missingInputs = rule.inputs.filter(ware => !parts.some(part => part.stock?.kind === "input" &&
    (part.stock.ware === ware || part.stock.wares?.includes(ware))));
  const missingOutputs = rule.outputs.filter(ware => !parts.some(part =>
    part.stock && (part.stock.kind ?? "output") === "output" &&
    (part.stock.ware === ware || part.stock.wares?.includes(ware))));
  if (!missingInputs.length && !missingOutputs.length) return;
  const bounds = parts.map(part => getRomanPartBounds(part));
  const left = Math.min(...bounds.map(bound => bound.min[0])) - .26;
  const rear = Math.min(...bounds.map(bound => bound.min[2]));
  const front = Math.max(...bounds.map(bound => bound.max[2]));
  const categories = [...missingInputs.map(ware => ({ ware, kind: "input" as const, aliases: undefined as string[] | undefined })),
    ...(missingOutputs.length ? [{ ware: missingOutputs[0]!, kind: "output" as const, aliases: missingOutputs }] : [])];
  categories.forEach((category, index) => {
    const z = rear + .48 + index * Math.max(.5, (front - rear - .8) / Math.max(1, categories.length));
    const recipe = createWareRecipe(category.ware, detailed);
    const wareBounds = recipe.parts.map(part => getRomanPartBounds(part));
    const bottom = Math.min(...wareBounds.map(bound => bound.min[1]));
    const slots = category.kind === "output" ? 6 : 1;
    for (let slot = 0; slot < slots; slot++) {
      const center: Point3 = [left - (slots > 1 ? (slot % 2) * .32 : 0), .18 - bottom,
        z + (slots > 1 ? Math.floor(slot / 2) * .32 : 0)];
      for (const piece of recipe.parts) {
        if (!detailed && category.ware === "water" && piece.shape === "cord") continue;
        parts.push({ ...piece,
        position: piece.position.map((value, axis) => value + center[axis]!) as Point3,
        stock: { ware: category.ware, wares: category.aliases, kind: category.kind, slot }
      });
      }
    }
  });
};
