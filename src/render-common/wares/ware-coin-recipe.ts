import type { Point3 } from "../buildings/building-recipe";
import type { AddPart } from "../buildings/roman-resource-workshops";

/** One inventory unit is one physical coin in stock, carry, carts and icons. */
export const COIN_DIAMETER = .14;
export const COIN_THICKNESS = .02;
const GOLD: Point3 = [1.12, 1.04, .78];

export const addGoldCoins = (part: AddPart) => {
  part("gold", [0, 0, 0], [COIN_DIAMETER, COIN_THICKNESS - .0004, COIN_DIAMETER], 3,
    "cylinder", undefined, GOLD);
  // Both stamped faces borrow the existing single-coin ship-emblem artwork. No pile is depicted.
  for (const side of [-1, 1]) part("paint", [0, side * .0099, 0], [.128, .0002, .128], 3,
    "cylinder", undefined, [1, 1, 1]);
};
