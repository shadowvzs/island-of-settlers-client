/**
 * Relief amplitude, independent of the mountain-count setting. Applied before final slope,
 * settlement plateau and coast repairs, so all derived gameplay layers see the same surface.
 * The shallow coastal ramp and underwater terrain stay intact. No extra runtime geometry.
 */
export const applyTerrainVariation = (heights: Float32Array, variation = 1) => {
  const amount = Number.isFinite(variation) ? Math.max(0, Math.min(2, variation)) : 1;
  if (amount === 1) return;
  const plainHeight = .7;
  for (let index = 0; index < heights.length; index++) {
    const height = heights[index]!;
    if (height > plainHeight) heights[index] = plainHeight + (height - plainHeight) * amount;
  }
};
