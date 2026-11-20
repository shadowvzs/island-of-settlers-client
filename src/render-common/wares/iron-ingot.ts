import type { Point3 } from "../buildings/building-recipe";

/** One cast ingot fits inside the former bundle without changing cargo capacity or its carry action. */
export const IRON_INGOT_SIZE: Point3 = [.34, .105, .16];
export const IRON_INGOT_POSITION: Point3 = [0, .0025, 0];

/** Unit-space chamfer rings: lower bevel, tapered walls, raised rim and a shallow cast depression. */
export const IRON_INGOT_PROFILE = [
  { corner: .055, halfLength: .465, halfWidth: .465, y: -.5 },
  { corner: .055, halfLength: .5, halfWidth: .5, y: -.4 },
  { corner: .05, halfLength: .435, halfWidth: .415, y: .35 },
  { corner: .045, halfLength: .405, halfWidth: .375, y: .5 },
  { corner: .04, halfLength: .393, halfWidth: .36, y: .495 },
  { corner: .035, halfLength: .38, halfWidth: .335, y: .465 }
] as const;
