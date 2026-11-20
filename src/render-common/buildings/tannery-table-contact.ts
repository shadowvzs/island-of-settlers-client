import { WORKER_RADIUS } from "../workers/worker-dimensions";
import type { BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { stockWareDimensions } from "./ware-stock-envelope";

/** The table, rather than its smaller leather stack, sets the safe standing edge. */
const supportTable = (recipe: BuildingRecipe, scale: number, stock: Point3) => {
  const tables = recipe.parts.filter(part => !part.stock && part.surface === "wood" &&
    part.size[1] <= .08 && part.size[0] >= .3 && part.size[2] >= .3).map(part => getRomanPartBounds(part));
  return tables.find(bound => stock[0] >= bound.min[0] * scale && stock[0] <= bound.max[0] * scale &&
    stock[2] >= bound.min[2] * scale && stock[2] <= bound.max[2] * scale &&
    stock[1] >= bound.max[1] * scale && stock[1] - bound.max[1] * scale < 1);
};

export const tanneryTableApproach = (recipe: BuildingRecipe, scale: number, stock: Point3): Point3 | undefined => {
  const support = supportTable(recipe, scale, stock);
  if (!support) return;
  const sign = stock[0] < 0 ? -1 : 1;
  const edge = sign < 0 ? support.min[0] : support.max[0];
  return [edge * scale + sign * (WORKER_RADIUS + .005), 0, stock[2]];
};

/** Keep the complete canonical stack footprint supported, inset35mm from its working edge. */
export const seatTanneryTableStock = (recipe: BuildingRecipe, scale: number,
  slots: import("./roman-ware-stock").RomanWareStockSlot[]) => {
  for (const slot of slots) {
    if (slot.stock.handlingEdge !== "outward-x") continue;
    const stock = slot.center.map(value => value * scale) as Point3;
    const support = supportTable(recipe, scale, stock);
    if (!support) continue;
    const size = stockWareDimensions(slot.stock.ware, scale, slot.yaw, slot.horizontalSpan).size;
    const sign = stock[0] < 0 ? -1 : 1;
    const edge = sign < 0 ? support.min[0] : support.max[0];
    slot.center[0] = edge - sign * (size[0] / 2 + .035 / scale);
  }
  return slots;
};
