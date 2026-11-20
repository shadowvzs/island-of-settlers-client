import { getRomanPartBounds } from "../buildings/building-recipe-fit";
import { createWareRecipe } from "./ware-recipe";

const bounds = createWareRecipe("water", true).parts.map(part => getRomanPartBounds(part));
const minimum = [0, 1, 2].map(axis => Math.min(...bounds.map(bound => bound.min[axis]!)));
const maximum = [0, 1, 2].map(axis => Math.max(...bounds.map(bound => bound.max[axis]!)));
export const WATER_STOCK_CENTER_Y = (minimum[1]! + maximum[1]!) / 2;

/** Match the existing stock vessel's bounds when using the well's handled bucket. */
export const handledWaterBucketScale = (scale: { x: number; y: number; z: number }) => ({
  x: scale.x * (maximum[0]! - minimum[0]!) / .18,
  y: scale.y * (maximum[1]! - minimum[1]!) / .23,
  z: scale.z * (maximum[2]! - minimum[2]!) / .18
});

/** Existing well output size is the shared physical baseline for all handled water cargo. */
export const WATER_WARE_SCALE = { x: .6405008250949044, y: 1.215169084776758, z: .7722350373484663 };
