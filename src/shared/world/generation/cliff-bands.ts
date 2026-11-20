import { getCellCount, type GridSize } from "../grid-geometry";
import { createFbm, smoothstep } from "../noise";
import { deriveSeed } from "../rng";
import { HEIGHT_LEVEL_STEP } from "../world-data";
import { getTerraceMask, type ShapeFields } from "./heights";

/**
 * Tall cliff bands (MC-07, map generator option, off by default): on the terrace contours the
 * ground steps by three gameplay levels at once, a wall of about 3.3 units, broken by ramps where
 * a seeded segment noise is low (gaps of a few cells every 12-25 cells). Bands keep away from the
 * start, the building plateaus, the coast, the open border and the massifs; a band segment that
 * cuts building land off from the start is removed again. Walls are real gameplay cliffs.
 */
const BAND_STEP = HEIGHT_LEVEL_STEP * 3;
/** Lowest tier (one level above the sea): the walls rise from it in steps of BAND_STEP. */
const BAND_BASE = HEIGHT_LEVEL_STEP;
/** Ground between these heights takes part in the bands (lowland tiers, below the massifs). */
const BAND_HEIGHTS: [number, number] = [BAND_BASE + 0.3, BAND_BASE + BAND_STEP * 2.6];
/** Share of a step around its contour that the band reshapes (0.5 = the whole step). */
const BAND_REACH: [number, number] = [0.22, 0.42];
/** The step itself: a sharp riser at the middle of the step (share of BAND_STEP). */
const RISER: [number, number] = [0.47, 0.53];
/** Segment noise scale (cells): ramps every 12-25 cells. */
const SEGMENT_CELLS = 16;
/** Segment noise below which a band opens into a ramp, at the strongest option. */
const RAMP_SHARE = 0.26;
/** Terrace mask (heights.ts) and mountain mask ranges of band ground. */
const TERRACE_MASK: [number, number] = [0.08, 0.3];
const MASSIF_MASK: [number, number] = [0.55, 0.3];
/** Talus limit multiplier inside a band (1.3 -> 2.9 rise per cell); outside it nothing relaxes. */
const BAND_TALUS = 1.2;
const OUTSIDE_TALUS = 1000;
/** Cell rise of a gameplay cliff (gameplay.ts) and of a gentle, usable cell. */
const CLIFF_RISE = 1.5;
const GENTLE_RISE = 0.8;
/** Unreachable gentle cells a band may add before its segments are removed. */
const REACH_TOLERANCE = 24;
const REPAIR_PASSES = 3;

export interface CliffBandSites {
  /** True where no band may form (start, plateaus, open border; cell coordinates). */
  keepOut: (x: number, z: number) => boolean;
  start: { x: number; z: number };
}

/** 0..1 band strength per vertex (before the reach and the riser). */
const createBandSites = (grid: GridSize, heights: Float32Array, fields: ShapeFields, seed: number,
  amount: number, sites: CliffBandSites) => {
  const segments = createFbm(deriveSeed(seed, "cliff-bands"), { octaves: 2 });
  const ramp = RAMP_SHARE + (1 - amount) * 0.45;
  const stride = grid.cellsX + 1, mask = new Float32Array(heights.length);
  for (let index = 0; index < heights.length; index += 1) {
    const x = index % stride, z = Math.floor(index / stride), height = heights[index]!;
    if (height < BAND_HEIGHTS[0] || height > BAND_HEIGHTS[1] || sites.keepOut(x, z)) continue;
    const segment = smoothstep(ramp - 0.04, ramp + 0.04, segments(x / SEGMENT_CELLS, z / SEGMENT_CELLS) * 0.5 + 0.5);
    const terrace = smoothstep(TERRACE_MASK[0], TERRACE_MASK[1], getTerraceMask(fields, index));
    const lowland = smoothstep(MASSIF_MASK[0], MASSIF_MASK[1], fields.mountainMask[index]!);
    mask[index] = segment * terrace * lowland * smoothstep(0.15, 0.3, fields.continentalness[index]!);
  }
  return mask;
};

/** Steps the ground at the band contours (in place); returns the reshape weight per vertex. */
const stepBands = (heights: Float32Array, original: Float32Array, sites: Float32Array) => {
  const weight = new Float32Array(heights.length);
  for (let index = 0; index < heights.length; index += 1) {
    const height = original[index]!;
    heights[index] = height;
    if (sites[index]! <= 0) continue;
    const level = (height - BAND_BASE) / BAND_STEP, floor = Math.floor(level), within = level - floor;
    const near = 1 - smoothstep(BAND_REACH[0], BAND_REACH[1], Math.abs(within - 0.5));
    const stepped = BAND_BASE + (floor + smoothstep(RISER[0], RISER[1], within)) * BAND_STEP;
    weight[index] = near * sites[index]!;
    heights[index] = height + (stepped - height) * weight[index]!;
  }
  return weight;
};

const getCellRise = (grid: GridSize, heights: Float32Array, cell: number) => {
  const stride = grid.cellsX + 1, x = cell % grid.cellsX, z = Math.floor(cell / grid.cellsX);
  const a = heights[z * stride + x]!, b = heights[z * stride + x + 1]!;
  const c = heights[(z + 1) * stride + x]!, d = heights[(z + 1) * stride + x + 1]!;
  return { low: Math.min(a, b, c, d), rise: Math.max(a, b, c, d) - Math.min(a, b, c, d) };
};

/** Gentle land cells the start cannot walk to (4-connected over non-cliff land). */
const findUnreachableGentle = (grid: GridSize, heights: Float32Array, start: { x: number; z: number }) => {
  const count = getCellCount(grid), reached = new Uint8Array(count), queue: number[] = [];
  const passable = (cell: number) => { const { low, rise } = getCellRise(grid, heights, cell); return low > 0.05 && rise < CLIFF_RISE; };
  const first = Math.floor(start.z) * grid.cellsX + Math.floor(start.x);
  if (passable(first)) { reached[first] = 1; queue.push(first); }
  for (let head = 0; head < queue.length; head += 1) {
    const cell = queue[head]!, x = cell % grid.cellsX;
    for (const next of [x > 0 ? cell - 1 : -1, x < grid.cellsX - 1 ? cell + 1 : -1, cell - grid.cellsX, cell + grid.cellsX]) {
      if (next < 0 || next >= count || reached[next] || !passable(next)) continue;
      reached[next] = 1;
      queue.push(next);
    }
  }
  const unreachable = new Uint8Array(count);
  for (let cell = 0; cell < count; cell += 1) {
    const { low, rise } = getCellRise(grid, heights, cell);
    if (!reached[cell] && low > 0.05 && rise < GENTLE_RISE) unreachable[cell] = 1;
  }
  return unreachable;
};

const countSet = (values: Uint8Array) => values.reduce((sum, value) => sum + value, 0);

/** Drops the band sites around newly cut-off cells (a band segment within reach of them). */
const openCutOffSegments = (grid: GridSize, sites: Float32Array, cutOff: Uint8Array) => {
  const stride = grid.cellsX + 1, reach = 6;
  for (let cell = 0; cell < cutOff.length; cell += 1) {
    if (!cutOff[cell]) continue;
    const x = cell % grid.cellsX, z = Math.floor(cell / grid.cellsX);
    for (let dz = -reach; dz <= reach + 1; dz += 1) for (let dx = -reach; dx <= reach + 1; dx += 1) {
      const vx = x + dx, vz = z + dz;
      if (vx >= 0 && vz >= 0 && vx <= grid.cellsX && vz <= grid.cellsZ) sites[vz * stride + vx] = 0;
    }
  }
};

/**
 * Adds the cliff bands of the `amount` (0..1) in place and returns the talus scale for the final
 * slope limit (steep inside bands, nothing relaxes outside), or undefined when the option is off.
 */
export const applyCliffBands = (grid: GridSize, heights: Float32Array, fields: ShapeFields, seed: number,
  amount: number | undefined, sites: CliffBandSites) => {
  if (!amount || amount <= 0) return undefined;
  const original = Float32Array.from(heights);
  const baseline = countSet(findUnreachableGentle(grid, original, sites.start));
  const bandSites = createBandSites(grid, heights, fields, seed, amount, sites);
  let weight = stepBands(heights, original, bandSites);
  for (let pass = 0; pass < REPAIR_PASSES; pass += 1) {
    const unreachable = findUnreachableGentle(grid, heights, sites.start);
    if (countSet(unreachable) <= baseline + REACH_TOLERANCE) break;
    const before = findUnreachableGentle(grid, original, sites.start);
    for (let cell = 0; cell < unreachable.length; cell += 1) unreachable[cell] = unreachable[cell]! & (1 - before[cell]!);
    openCutOffSegments(grid, bandSites, unreachable);
    weight = stepBands(heights, original, bandSites);
  }
  return weight.map(value => (value > 0.02 ? 1 + value * BAND_TALUS : OUTSIDE_TALUS));
};
