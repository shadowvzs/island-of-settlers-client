import { dot, normalize, type Vec3 } from "../props/mesh-builder";
import { add, scale, subtract, type TubeJunction } from "../props/tree-parts";
import type { WoodLimb } from "./tree-model";

/** Finds the actual parent attachment in authored model space; only the rendered mesh changes.
 * The existing two root rings form the collar, so branch/vertex/index counts stay fixed. */
export const findTreeJunction = (child: WoodLimb, wood: readonly WoodLimb[], units: number)
  : TubeJunction | undefined => {
  if (child.depth === 0 || child.root || child.points.length < 2) return undefined;
  const start = child.points[0]!;
  let best: { axis: Vec3; origin: Vec3; radius: number } | undefined;
  let closest = Infinity;
  for (const parent of wood) {
    if (parent.depth !== child.depth - 1 || parent.root) continue;
    for (let index = 1; index < parent.points.length; index++) {
      const from = parent.points[index - 1]!, segment = subtract(parent.points[index]!, from);
      const lengthSquared = dot(segment, segment);
      const t = Math.max(0, Math.min(1, dot(subtract(start, from), segment) / Math.max(1e-9, lengthSquared)));
      const origin = add(from, scale(segment, t)), delta = subtract(start, origin);
      const distance = dot(delta, delta);
      if (distance >= closest) continue;
      closest = distance;
      best = { axis: normalize(segment), origin: scale(origin, units),
        radius: (parent.radii[index - 1]! * (1 - t) + parent.radii[index]! * t) * units };
    }
  }
  if (!best || closest > (best.radius / units * .8) ** 2 || best.radius < child.radii[0]! * units * 1.05)
    return undefined;
  return best;
};
