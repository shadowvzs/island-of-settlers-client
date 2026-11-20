import type { GridSize } from "../grid-geometry";

/**
 * Talus limit (rise per cell): about 52 degrees, the steepest believable natural mountain face at
 * this grid scale. Wanted cliffs come later: the terraces (cliff mask), river falls and gorges.
 */
const MAX_SLOPE = 1.3;
const PASSES = 8;

/** Neighbour offsets handled from each vertex (each pair once) and their distance in cells. */
const getNeighbours = (stride: number) =>
  [
    [1, 1],
    [stride, 1],
    [stride + 1, Math.SQRT2],
    [stride - 1, Math.SQRT2]
  ] as const;

/** Moves half of the excess over the talus limit from the higher vertex to the lower one. */
const relaxPair = (heights: Float32Array, a: number, b: number, limit: number) => {
  const high = heights[a]! >= heights[b]! ? a : b;
  const low = high === a ? b : a;
  const excess = heights[high]! - heights[low]! - limit;
  if (excess <= 0) return;
  heights[high] = heights[high]! - excess * 0.5;
  heights[low] = heights[low]! + excess * 0.5;
};

/** > 0 on land (the landform): the sea floor and its coast are never moved. */
type Continentalness = Float32Array;

/**
 * Optional per vertex multiplier (>= 1) of the talus limit: steeper faces survive inside a zone
 * (summit uplift, cliff bands). A pair uses the smaller scale of its two vertices.
 */
export type TalusScale = Float32Array;

const getPairLimit = (limitScale: TalusScale | undefined, a: number, b: number, distance: number) => {
  if (!limitScale) return MAX_SLOPE * distance;
  return MAX_SLOPE * distance * Math.min(limitScale[a]!, limitScale[b]!);
};

const relaxVertex = (
  grid: GridSize,
  heights: Float32Array,
  continentalness: Continentalness,
  index: number,
  limitScale?: TalusScale
) => {
  if (continentalness[index]! <= 0) return;
  const stride = grid.cellsX + 1;
  const x = index % stride;
  for (const [offset, distance] of getNeighbours(stride)) {
    const other = index + offset;
    if (other >= heights.length || continentalness[other]! <= 0) continue;
    if ((offset === 1 || offset === stride + 1) && x === grid.cellsX) continue;
    if (offset === stride - 1 && x === 0) continue;
    relaxPair(heights, index, other, getPairLimit(limitScale, index, other, distance));
  }
};

/**
 * Thermal (talus) relaxation on land: faces steeper than MAX_SLOPE shed material downhill until
 * they reach it, so erosion pits and narrow spikes cannot leave 0 -> 10 towers. Alternating sweep
 * directions converge in a few passes; mass is conserved; the sea stays untouched. Erosion pits
 * (even below sea level inside the land) fill up again. `limitScale` keeps steeper faces in a zone;
 * absent, every pair uses MAX_SLOPE (the original behaviour, byte for byte).
 */
export const limitSlopes = (
  grid: GridSize,
  heights: Float32Array,
  continentalness: Continentalness,
  limitScale?: TalusScale
) => {
  for (let pass = 0; pass < PASSES; pass += 1) {
    if (pass % 2 === 0) {
      for (let index = 0; index < heights.length; index += 1) {
        relaxVertex(grid, heights, continentalness, index, limitScale);
      }
    } else {
      for (let index = heights.length - 1; index >= 0; index -= 1) {
        relaxVertex(grid, heights, continentalness, index, limitScale);
      }
    }
  }
};
