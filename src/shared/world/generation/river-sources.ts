import type { GridSize } from "../grid-geometry";
import { type Random,shuffle } from "../rng";

/** Springs lie in the upper fifth of the land: in the mountains, not on the plain. */
const SPRING_HEIGHT_QUANTILE = 0.8;
/** Fallback sources: the highest few percent of the land. */
const HIGH_AREA_QUANTILE = 0.93;
/** A spring sits in a hollow: the ring this far out (cells) is higher on average by... */
const HOLLOW_RING = 4;
const HOLLOW_DEPTH = 0.1;
/** ...and below a peak or ridge: something this far out (cells) rises at least this much. */
const PEAK_RING = 8;
const BELOW_PEAK = 0.6;
const RING_SAMPLES = 12;

const RING_DIRECTIONS = Array.from({ length: RING_SAMPLES }, (_, step) => {
  const angle = (step / RING_SAMPLES) * Math.PI * 2;
  return [Math.cos(angle), Math.sin(angle)] as const;
});

/** The median land is the plain: a source must rise this much above it (flat-topped islands too). */
const PLAIN_QUANTILE = 0.5;
const ABOVE_PLAIN = 0.5;

const createLandQuantile = (heights: Float32Array, seaLevel: number) => {
  const land = heights.filter((height) => height > seaLevel).sort();
  return (fraction: number) => land[Math.floor(land.length * fraction)] ?? Infinity;
};

/** Mean and highest height on a ring around a vertex (the ring lies inside the map). */
const sampleRing = (grid: GridSize, heights: Float32Array, index: number, radius: number) => {
  const stride = grid.cellsX + 1;
  const x = index % stride;
  const z = Math.floor(index / stride);
  let sum = 0;
  let highest = -Infinity;
  for (const [dx, dz] of RING_DIRECTIONS) {
    const height = heights[Math.round(z + dz * radius) * stride + Math.round(x + dx * radius)]!;
    sum += height;
    highest = Math.max(highest, height);
  }
  return { highest, mean: sum / RING_SAMPLES };
};

const isInsideBy = (grid: GridSize, index: number, margin: number) => {
  const stride = grid.cellsX + 1;
  const x = index % stride;
  const z = Math.floor(index / stride);
  return Math.min(x, z, grid.cellsX - x, grid.cellsZ - z) >= margin;
};

/** A mountain spring: a hollow (valley head) below a higher peak or ridge. */
const isSpring = (grid: GridSize, heights: Float32Array, index: number) => {
  const height = heights[index]!;
  if (sampleRing(grid, heights, index, HOLLOW_RING).mean < height + HOLLOW_DEPTH) return false;
  return sampleRing(grid, heights, index, PEAK_RING).highest >= height + BELOW_PEAK;
};

/** Fallback source: every vertex in a 5 x 5 block is high (no single erosion spikes). */
const isHighArea = (grid: GridSize, heights: Float32Array, index: number, minHeight: number) => {
  const stride = grid.cellsX + 1;
  for (let dz = -2; dz <= 2; dz += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      if (heights[index + dz * stride + dx]! < minHeight) return false;
    }
  }
  return true;
};

/**
 * Source candidates in order of preference: mountain springs (valley heads below the peaks,
 * shuffled), then the highest areas (shuffled) where a map has no such valleys.
 */
export const findRiverSources = (
  grid: GridSize,
  heights: Float32Array,
  seaLevel: number,
  random: Random
) => {
  const landQuantile = createLandQuantile(heights, seaLevel);
  const springHeight = landQuantile(SPRING_HEIGHT_QUANTILE);
  const highHeight = landQuantile(HIGH_AREA_QUANTILE);
  // Playable islands are mostly a flat plain, so their upper quantiles can equal the plain itself.
  const plainTop = landQuantile(PLAIN_QUANTILE) + ABOVE_PLAIN;
  const springs: number[] = [];
  const highAreas: number[] = [];
  for (let index = 0; index < heights.length; index += 1) {
    const height = heights[index]!;
    if (height < springHeight || height < plainTop || !isInsideBy(grid, index, PEAK_RING + 1)) continue;
    if (isSpring(grid, heights, index)) springs.push(index);
    else if (isHighArea(grid, heights, index, highHeight)) highAreas.push(index);
  }
  return [...shuffle(springs, random), ...shuffle(highAreas, random)];
};
