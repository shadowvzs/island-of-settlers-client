import type { SettlementContext } from "../settlement-types";
import { PLOT_KIND_MINE, PLOT_ROTATIONS, PLOT_VERDICT_STRAIGHT, PLOT_VERDICT_TURNED } from "./constants";
import type { PlotWatch } from "./plot-cache-watch";
import type { PlotClass } from "./plot-classes";
import { passesPlotPrecheck } from "./plot-precheck";
import { passesScannedPlot, preparePlotGround, preparePlotScan } from "./plot-scan";

/**
 * One class's candidate plots (plan §3.5), ascending by static score: each key is
 * `score × span + entry`, where the score is the squared distance (in half cells) of the turned plot's centre
 * to the faction's home, `entry = cornerCell × PLOT_ROTATIONS + rotation` and `span` the entry count of the
 * world. Turns with the same footprint pass or fail the pre-check together and score alike, so one key stands for
 * all of them: rotation 0 for every turn of a square plot, 0 (turns 0/2) or 1 (turns 1/3) for an oblong one.
 * Keys are exact integers below 2^53, so a plain numeric sort orders them by score, then corner, then rotation:
 * one total order, which the strict mode compares key by key.
 */
export interface PlotClassEntries {
  readonly key: number;
  keys: Float64Array;
  length: number;
  readonly plotClass: PlotClass;
  /** The world's entry count: `entry = key % span` (set by every build). */
  span: number;
  /** Scratch of the same capacity: new keys of a re-test, a rebuild's keys before the swap. */
  spare: Float64Array;
}

/** Where the scores are measured from, what territory the corners need and the watched road mask. */
export interface PlotSearch {
  homeX2: number;
  homeZ2: number;
  owned: Uint8Array;
  span: number;
  watch: PlotWatch;
}

/** A corner range (inclusive cells). */
export interface CornerRange {
  maxX: number;
  maxZ: number;
  minX: number;
  minZ: number;
}

export const createClassEntries = (key: number, plotClass: PlotClass): PlotClassEntries =>
  ({ key, keys: new Float64Array(0), length: 0, plotClass, span: 1, spare: new Float64Array(0) });

export const entryOfKey = (key: number, span: number) => key % span;

/**
 * How many turns a key's entry stands for: 4 for a square plot (turns 0-3), else 2 (its turn and the opposite,
 * `PLOT_ROTATIONS / turns` apart).
 */
export const turnsOfEntry = ({ depth, width }: PlotClass) => width === depth ? PLOT_ROTATIONS : 2;

const grown = (array: Float64Array, needed: number, kept: number) => {
  if (array.length >= needed) return array;
  const next = new Float64Array(Math.max(needed, array.length * 2));
  next.set(array.subarray(0, kept));
  return next;
};

const keyOf = (search: PlotSearch, cellsX: number, x: number, z: number, width: number, depth: number,
  rotation: number) => {
  const dx = 2 * x + width - search.homeX2, dz = 2 * z + depth - search.homeZ2;
  return (dx * dx + dz * dz) * search.span + (z * cellsX + x) * PLOT_ROTATIONS + rotation;
};

/** Per corner of the scanned range: bit 1 the straight footprint passes, bit 2 the turned one (turns 1/3). */
let verdicts = new Uint8Array(0);

const cornerIndex = (range: CornerRange, x: number, z: number) => (z - range.minZ) * (range.maxX - range.minX + 1) +
  x - range.minX;

/** The direct pre-check per corner (the strict mode's reference). */
const checkDirectly = (context: SettlementContext, search: PlotSearch, plotClass: PlotClass, range: CornerRange) => {
  const { cellsX } = context.options.world, { depth, kind, width } = plotClass;
  for (let z = range.minZ; z <= range.maxZ; z++) for (let x = range.minX; x <= range.maxX; x++) {
    const index = cornerIndex(range, x, z);
    verdicts[index] = 0;
    if (search.owned[z * cellsX + x] !== 1) continue;
    const straight = passesPlotPrecheck(context, search, kind, x, z, width, depth);
    const turned = width === depth ? straight : passesPlotPrecheck(context, search, kind, x, z, depth, width);
    verdicts[index] = (straight ? PLOT_VERDICT_STRAIGHT : 0) | (turned ? PLOT_VERDICT_TURNED : 0);
  }
};

/** One turned footprint of every corner from the prepared tables, into `bit`. */
const scanFootprint = (context: SettlementContext, plotClass: PlotClass, range: CornerRange, width: number,
  depth: number, bit: number) => {
  if (plotClass.kind !== PLOT_KIND_MINE) preparePlotGround(context, range, width, depth);
  for (let z = range.minZ; z <= range.maxZ; z++) for (let x = range.minX; x <= range.maxX; x++)
    if (passesScannedPlot(context, range, plotClass.kind, x, z, width, depth)) {
      const index = cornerIndex(range, x, z);
      verdicts[index] = verdicts[index]! | bit;
    }
};

/** The same verdicts from prefix sums and sliding height extremes (rebuilds and re-tests). */
const checkByTables = (context: SettlementContext, search: PlotSearch, plotClass: PlotClass, range: CornerRange) => {
  const { depth, kind, width } = plotClass, size = (range.maxX - range.minX + 1) * (range.maxZ - range.minZ + 1);
  verdicts.fill(0, 0, size);
  preparePlotScan(context, search.owned, search.watch, kind, range, Math.max(width, depth));
  scanFootprint(context, plotClass, range, width, depth, PLOT_VERDICT_STRAIGHT);
  // A square plot's key is its straight verdict (one key for all four turns).
  if (width !== depth) scanFootprint(context, plotClass, range, depth, width, PLOT_VERDICT_TURNED);
};

/**
 * Appends the keys of every passing corner of `range` to `entries.spare` from index 0 and returns their count
 * (unsorted): turns with one footprint share a key (see `rotationsOfEntry`), so a corner has one key for a square
 * plot and up to two (straight, turned) for an oblong one.
 */
const scanCorners = (context: SettlementContext, search: PlotSearch, entries: PlotClassEntries,
  range: CornerRange, direct: boolean) => {
  const { cellsX } = context.options.world, { depth, width } = entries.plotClass;
  const size = (range.maxX - range.minX + 1) * (range.maxZ - range.minZ + 1);
  if (verdicts.length < size) verdicts = new Uint8Array(size);
  if (direct) checkDirectly(context, search, entries.plotClass, range);
  else checkByTables(context, search, entries.plotClass, range);
  let count = 0;
  for (let z = range.minZ; z <= range.maxZ; z++) for (let x = range.minX; x <= range.maxX; x++) {
    const verdict = verdicts[cornerIndex(range, x, z)]!;
    if (!verdict) continue;
    entries.spare = grown(entries.spare, count + 2, count);
    if (verdict & PLOT_VERDICT_STRAIGHT) entries.spare[count++] = keyOf(search, cellsX, x, z, width, depth, 0);
    if (verdict & PLOT_VERDICT_TURNED && width !== depth)
      entries.spare[count++] = keyOf(search, cellsX, x, z, depth, width, 1);
  }
  return count;
};

/**
 * Every passing plot of the window, sorted (a full rebuild). `direct`: judged corner by corner with the direct
 * pre-check instead of the tables (the strict mode's independent reference).
 */
export const buildClassEntries = (context: SettlementContext, search: PlotSearch, entries: PlotClassEntries,
  window: CornerRange, direct = false) => {
  const count = window.maxX < window.minX ? 0 : scanCorners(context, search, entries, window, direct);
  entries.spare.subarray(0, count).sort();
  const keys = entries.keys;
  entries.keys = entries.spare;
  entries.spare = grown(keys, entries.keys.length, 0);
  entries.length = count;
  entries.span = search.span;
};

const cornerInRange = (entry: number, cellsX: number, range: CornerRange) => {
  const cell = Math.floor(entry / PLOT_ROTATIONS), x = cell % cellsX, z = Math.floor(cell / cellsX);
  return x >= range.minX && x <= range.maxX && z >= range.minZ && z <= range.maxZ;
};

/** Drops the keys whose corner lies in `range`, keeping the order. */
const removeRange = (entries: PlotClassEntries, span: number, cellsX: number, range: CornerRange) => {
  let kept = 0;
  for (let index = 0; index < entries.length; index++) {
    const key = entries.keys[index]!;
    if (!cornerInRange(entryOfKey(key, span), cellsX, range)) entries.keys[kept++] = key;
  }
  entries.length = kept;
};

/** Merges the sorted `spare[0..count)` into the sorted keys, from the back (no third buffer). */
const mergeSpare = (entries: PlotClassEntries, count: number) => {
  entries.keys = grown(entries.keys, entries.length + count, entries.length);
  const { keys, spare } = entries;
  let kept = entries.length - 1, added = count - 1;
  for (let target = entries.length + count - 1; added >= 0; target--)
    keys[target] = kept >= 0 && keys[kept]! > spare[added]! ? keys[kept--]! : spare[added--]!;
  entries.length += count;
};

/** Re-tests the corners of `range` (already clamped to the window): drop their keys, scan them again, merge. */
export const retestClassEntries = (context: SettlementContext, search: PlotSearch, entries: PlotClassEntries,
  range: CornerRange) => {
  const { cellsX } = context.options.world;
  removeRange(entries, search.span, cellsX, range);
  const count = range.maxX < range.minX || range.maxZ < range.minZ ? 0
    : scanCorners(context, search, entries, range, false);
  entries.spare.subarray(0, count).sort();
  mergeSpare(entries, count);
};

/** True when both hold the same keys in the same order (the strict mode's comparison). */
export const sameClassEntries = (first: PlotClassEntries, second: PlotClassEntries) => {
  if (first.length !== second.length) return false;
  for (let index = 0; index < first.length; index++) if (first.keys[index] !== second.keys[index]) return false;
  return true;
};
