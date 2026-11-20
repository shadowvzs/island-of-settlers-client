import { getVertexCount, type GridSize } from "../grid-geometry";

const DIAGONAL = Math.SQRT2;

const relax = (distances: Float32Array, index: number, neighbour: number, cost: number) => {
  const candidate = distances[neighbour]! + cost;
  if (candidate < distances[index]!) distances[index] = candidate;
};

/**
 * Chamfer distance (1 / sqrt 2 steps) on the vertex grid to the nearest source vertex, in cells.
 * Two passes, O(n); accurate enough for foam bands, moisture and shading.
 */
export const computeDistanceField = (grid: GridSize, isSource: (index: number) => boolean) => {
  const stride = grid.cellsX + 1;
  const rows = grid.cellsZ + 1;
  const distances = new Float32Array(getVertexCount(grid));
  for (let index = 0; index < distances.length; index += 1) {
    distances[index] = isSource(index) ? 0 : 1e9;
  }
  for (let z = 0; z < rows; z += 1) {
    for (let x = 0; x < stride; x += 1) {
      const index = z * stride + x;
      if (x > 0) relax(distances, index, index - 1, 1);
      if (z === 0) continue;
      relax(distances, index, index - stride, 1);
      if (x > 0) relax(distances, index, index - stride - 1, DIAGONAL);
      if (x < stride - 1) relax(distances, index, index - stride + 1, DIAGONAL);
    }
  }
  for (let z = rows - 1; z >= 0; z -= 1) {
    for (let x = stride - 1; x >= 0; x -= 1) {
      const index = z * stride + x;
      if (x < stride - 1) relax(distances, index, index + 1, 1);
      if (z === rows - 1) continue;
      relax(distances, index, index + stride, 1);
      if (x < stride - 1) relax(distances, index, index + stride + 1, DIAGONAL);
      if (x > 0) relax(distances, index, index + stride - 1, DIAGONAL);
    }
  }
  return distances;
};

/** Signed distance to the shoreline: positive on land, negative in water, clamped. */
export const computeCoastDistance = (grid: GridSize, waterDepth: Float32Array, limit: number) => {
  const isWater = (index: number) => waterDepth[index]! > 0;
  const toWater = computeDistanceField(grid, isWater);
  const toLand = computeDistanceField(grid, (index) => !isWater(index));
  return Float32Array.from(toWater, (distance, index) =>
    isWater(index) ? -Math.min(limit, toLand[index]!) : Math.min(limit, distance)
  );
};

/** Water this far from a river counts as sea. */
const SEA_RIVER_DISTANCE = 2.5;

/** Distance (cells) to the sea per vertex; rivers and their mouths do not count. */
export const computeSeaDistance = (
  grid: GridSize,
  waterDepth: Float32Array,
  riverDistance: Float32Array
) =>
  computeDistanceField(
    grid,
    (index) => waterDepth[index]! > 0 && riverDistance[index]! > SEA_RIVER_DISTANCE
  );
