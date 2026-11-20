import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingPart, Point3 } from "../buildings/building-recipe";
import { getRomanPartBounds } from "../buildings/building-recipe-fit";
import { CART_CARGO_LAYOUTS } from "../logistics/cart-cargo-layouts";
import { woodWareAppearance } from "./advanced-material-variants";

/** Fallback stock/contact parts share the approved imported cargo's measured, centred envelope. */
export const fitTimberRecipeEnvelope = (parts: BuildingPart[], ware: string) => {
  const appearance = woodWareAppearance(ware);
  if (!appearance) return;
  const layout = CART_CARGO_LAYOUTS[appearance.base];
  const target = [layout.width / layout.scale, layout.height / layout.scale, layout.depth / layout.scale];
  const bounds = parts.map(part => getRomanPartBounds(part));
  const min = target.map((_value, axis) => Math.min(...bounds.map(box => box.min[axis]!)));
  const max = target.map((_value, axis) => Math.max(...bounds.map(box => box.max[axis]!)));
  const scale = target.map((value, axis) => value / (max[axis]! - min[axis]!));
  for (const part of parts) {
    part.position = part.position.map((value, axis) =>
      (value - (min[axis]! + max[axis]!) / 2) * scale[axis]!) as Point3;
    // Authored timber pieces are axis aligned or quarter turned (lying trunks / flush branch cuts).
    const localScale = [...scale];
    if (Math.abs(DMath.sin(part.rotation?.[2] ?? 0)) > .5)
      [localScale[0], localScale[1]] = [localScale[1]!, localScale[0]!];
    if (Math.abs(DMath.sin(part.rotation?.[0] ?? 0)) > .5)
      [localScale[1], localScale[2]] = [localScale[2]!, localScale[1]!];
    part.size = part.size.map((value, axis) => value * localScale[axis]!) as Point3;
  }
};
