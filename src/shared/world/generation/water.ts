import type { GridSize } from "../grid-geometry";

/** Below sea level vertices reachable from the map border (4-connected flood fill). */
export const floodSea = (grid: GridSize, heights: Float32Array, seaLevel: number) => {
  const stride = grid.cellsX + 1;
  const sea = new Uint8Array(heights.length);
  const stack: number[] = [];
  for (let index = 0; index < heights.length; index += 1) {
    const x = index % stride;
    const z = Math.floor(index / stride);
    const isBorder = x === 0 || z === 0 || x === grid.cellsX || z === grid.cellsZ;
    if (isBorder && heights[index]! <= seaLevel) stack.push(index);
  }
  while (stack.length > 0) {
    const index = stack.pop()!;
    if (sea[index] || heights[index]! > seaLevel) continue;
    sea[index] = 1;
    const x = index % stride;
    if (x > 0) stack.push(index - 1);
    if (x < grid.cellsX) stack.push(index + 1);
    if (index >= stride) stack.push(index - stride);
    if (index + stride < heights.length) stack.push(index + stride);
  }
  return sea;
};

/**
 * Water surface per vertex (river level, else sea level) and water depth. Inland pits below the
 * sea that are not rivers are filled up, so there is no unintended lake.
 */
export const createWaterLayers = (
  grid: GridSize,
  heights: Float32Array,
  riverSurface: Float32Array,
  seaLevel: number
) => {
  const sea = floodSea(grid, heights, seaLevel);
  const waterSurface = new Float32Array(heights.length);
  const waterDepth = new Float32Array(heights.length);
  for (let index = 0; index < heights.length; index += 1) {
    const river = riverSurface[index]!;
    const hasRiver = !Number.isNaN(river);
    if (!sea[index] && !hasRiver && heights[index]! <= seaLevel) heights[index] = seaLevel + 0.05;
    const surface = hasRiver ? river : seaLevel;
    waterSurface[index] = surface;
    waterDepth[index] = Math.max(0, surface - heights[index]!);
  }
  return { waterDepth, waterSurface };
};
