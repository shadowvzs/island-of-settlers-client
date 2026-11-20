import { getTerraceMask, type ShapeFields } from "./heights";

/**
 * Gentle sandy beaches (owner, 2026-10-13): the rounded foot of the hills and massifs
 * (heights.ts, smoothMax) lifted the whole lowland by about .6 right up to the water, which left a
 * 35-45 degree sand bank at every lowland shore and kept the Fisher on its top edge. After erosion
 * the land height above the sea is scaled by the base `beachScale` (the foot fading out over the
 * last cells before the water), so beaches slope gently into the sea while the inland terrain,
 * erosion, plateaus and the start stay as before. Terraced cliff coasts keep their full height.
 */
export const lowerBeaches = (
  heights: Float32Array,
  beachScale: Float32Array,
  fields: ShapeFields,
  seaLevel: number
) => {
  for (let index = 0; index < heights.length; index += 1) {
    const above = heights[index]! - seaLevel;
    const scale = beachScale[index]!;
    if (above <= 0 || scale >= 1) continue;
    const kept = scale + (1 - scale) * getTerraceMask(fields, index);
    heights[index] = seaLevel + above * kept;
  }
};
