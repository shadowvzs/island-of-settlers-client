import { DMath } from "../../shared/math/deterministic-math";
import { createWareRecipe } from "../wares/ware-recipe";
import type { Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { withBuildingStock } from "./building-stock-parts";
import type { AddPart } from "./roman-resource-workshops";

/** Place the same original carried ware in a grounded, explicitly inventoried yard slot. */
export const addPositionedRomanWareStock = (
  part: AddPart, ware: string, slot: number, kind: "input" | "output",
  center: Point3, detailed: boolean, yaw = 0
) => {
  const recipe = createWareRecipe(ware, detailed);
  const bottom = Math.min(...recipe.parts.map(piece => getRomanPartBounds(piece).min[1]));
  const cosine = DMath.cos(yaw), sine = DMath.sin(yaw);
  const stockPart = withBuildingStock(part, ware, slot, kind);
  for (const piece of recipe.parts) {
    const [x, y, z] = piece.position;
    stockPart(piece.surface, [center[0] + x * cosine + z * sine,
      center[1] + y - bottom, center[2] - x * sine + z * cosine],
    piece.size, piece.stage, piece.shape,
    [piece.rotation?.[0] ?? 0, (piece.rotation?.[1] ?? 0) + yaw, piece.rotation?.[2] ?? 0], piece.tint);
  }
};
