import { PLOT_GENTLE_RISE, PLOT_GROUND_MARGIN, PLOT_SPACING } from "../constants";
import { foundationCellReason } from "../settlement-placement";
import type { SettlementContext } from "../settlement-types";
import { PLOT_KIND_MINE } from "./constants";
import type { CornerRange } from "./plot-cache-entries";
import { isWatchedRoadCell, type PlotWatch } from "./plot-cache-watch";
import { isDepositCell } from "./plot-precheck";

/**
 * The table-driven form of `passesPlotPrecheck` for a whole corner range (a cache rebuild or re-test): prefix sums
 * of the cells a plot may not cover, of the lane blockers and of the deposit cells answer each rectangle in O(1),
 * and sliding extremes of the heights answer the gentle-ground test per corner. Same answers as the direct
 * pre-check, which the strict mode keeps as its reference. Scratch arrays grow and are reused (no allocation once
 * warm).
 */
interface ScanArea {
  /** Cells of the table area (world cells, inclusive), its columns and rows. */
  columns: number;
  minX: number;
  minZ: number;
  rows: number;
}

let plotSums: Int32Array = new Int32Array(0);
let laneSums: Int32Array = new Int32Array(0);
let depositSums: Int32Array = new Int32Array(0);
let marks: Uint8Array = new Uint8Array(0);
let rowHigh: Float32Array = new Float32Array(0);
let rowLow: Float32Array = new Float32Array(0);
let high: Float32Array = new Float32Array(0);
let low: Float32Array = new Float32Array(0);
let highQueue: Int32Array = new Int32Array(0);
let lowQueue: Int32Array = new Int32Array(0);

const area: ScanArea = { columns: 0, minX: 0, minZ: 0, rows: 0 };

const grownInt = (array: Int32Array, size: number): Int32Array => array.length >= size ? array : new Int32Array(size);
const grownFloat = (array: Float32Array, size: number): Float32Array =>
  array.length >= size ? array : new Float32Array(size);

/** Prefix sum of the area's `marks` into `sums` (stride columns + 1). */
const fillSums = (sums: Int32Array) => {
  const stride = area.columns + 1;
  sums.fill(0, 0, stride * (area.rows + 1));
  for (let z = 0; z < area.rows; z++) for (let x = 0; x < area.columns; x++)
    sums[(z + 1) * stride + x + 1] = marks[z * area.columns + x]! + sums[z * stride + x + 1]! +
      sums[(z + 1) * stride + x]! - sums[z * stride + x]!;
};

/** The sum over world cells [left, right) × [top, bottom) clamped to the area. */
const rectSum = (sums: Int32Array, left: number, top: number, right: number, bottom: number) => {
  const stride = area.columns + 1;
  const x0 = Math.max(0, left - area.minX), x1 = Math.min(area.columns, right - area.minX);
  const z0 = Math.max(0, top - area.minZ), z1 = Math.min(area.rows, bottom - area.minZ);
  if (x1 <= x0 || z1 <= z0) return 0;
  return sums[z1 * stride + x1]! - sums[z0 * stride + x1]! - sums[z1 * stride + x0]! + sums[z0 * stride + x0]!;
};

/**
 * One sliding pass (reused, so a pass allocates nothing): output `index` (at `outOffset + index × outStep`) takes
 * the highest of `highs` and the lowest of `lows` over the source indices from `max(0, first + index − margin)` to
 * `min(upper, first + index + size + margin)`, minus `shift`; a source index `at` reads `offset + at × step`.
 */
const pass = { count: 0, first: 0, highs: high, lows: low, offset: 0, outOffset: 0, outStep: 1, shift: 0, size: 0,
  step: 1, upper: 0 };

/** Monotonic queues over the pass (both bounds only grow with the index). */
const slideExtremes = (outHigh: Float32Array, outLow: Float32Array) => {
  const { count, first, highs, lows, offset, outOffset, outStep, shift, size, step, upper } = pass;
  let highHead = 0, highTail = 0, lowHead = 0, lowTail = 0;
  let next = Math.max(0, first - PLOT_GROUND_MARGIN) - shift;
  for (let index = 0; index < count; index++) {
    const from = Math.max(0, first + index - PLOT_GROUND_MARGIN) - shift;
    const last = Math.min(upper, first + index + size + PLOT_GROUND_MARGIN) - shift;
    for (; next <= last; next++) {
      const highValue = highs[offset + next * step]!, lowValue = lows[offset + next * step]!;
      while (highTail > highHead && highs[offset + highQueue[highTail - 1]! * step]! <= highValue) highTail--;
      highQueue[highTail++] = next;
      while (lowTail > lowHead && lows[offset + lowQueue[lowTail - 1]! * step]! >= lowValue) lowTail--;
      lowQueue[lowTail++] = next;
    }
    while (highQueue[highHead]! < from) highHead++;
    while (lowQueue[lowHead]! < from) lowHead++;
    outHigh[outOffset + index * outStep] = highs[offset + highQueue[highHead]! * step]!;
    outLow[outOffset + index * outStep] = lows[offset + lowQueue[lowHead]! * step]!;
  }
};

/** Per corner of `range`: the highest and lowest height over the plot (width × depth) with its ground margin. */
const fillHeightExtremes = (context: SettlementContext, range: CornerRange, width: number, depth: number) => {
  const { cellsX, cellsZ, heights } = context.options.world;
  const cornersX = range.maxX - range.minX + 1, cornersZ = range.maxZ - range.minZ + 1;
  const firstRow = Math.max(0, range.minZ - PLOT_GROUND_MARGIN);
  const rows = Math.min(cellsZ, range.maxZ + depth + PLOT_GROUND_MARGIN) - firstRow + 1;
  rowHigh = grownFloat(rowHigh, rows * cornersX); rowLow = grownFloat(rowLow, rows * cornersX);
  high = grownFloat(high, cornersX * cornersZ); low = grownFloat(low, cornersX * cornersZ);
  highQueue = grownInt(highQueue, Math.max(cellsX, cellsZ) + 1);
  lowQueue = grownInt(lowQueue, highQueue.length);
  Object.assign(pass, { count: cornersX, first: range.minX, highs: heights, lows: heights, outStep: 1, shift: 0,
    size: width, step: 1, upper: cellsX });
  for (let row = 0; row < rows; row++) {
    pass.offset = (firstRow + row) * (cellsX + 1);
    pass.outOffset = row * cornersX;
    slideExtremes(rowHigh, rowLow);
  }
  Object.assign(pass, { count: cornersZ, first: range.minZ, highs: rowHigh, lows: rowLow, outStep: cornersX,
    shift: firstRow, size: depth, step: cornersX, upper: cellsZ });
  for (let column = 0; column < cornersX; column++) {
    pass.offset = column;
    pass.outOffset = column;
    slideExtremes(high, low);
  }
};

/**
 * Prepares the tables for corners of `range` with plots up to `reach` cells wide or deep, of kind `kind`
 * (`owned`, `occupied`, road strips, the foundation rule of the kind, lane blockers, deposits).
 */
export const preparePlotScan = (context: SettlementContext, owned: Uint8Array, watch: PlotWatch, kind: number,
  range: CornerRange, reach: number) => {
  const { world } = context.options, { cellsX } = world, mine = kind === PLOT_KIND_MINE;
  area.minX = Math.max(0, range.minX - PLOT_SPACING); area.minZ = Math.max(0, range.minZ - PLOT_SPACING);
  area.columns = Math.min(cellsX, range.maxX + reach + PLOT_SPACING + 1) - area.minX;
  area.rows = Math.min(world.cellsZ, range.maxZ + reach + PLOT_SPACING + 1) - area.minZ;
  const size = (area.columns + 1) * (area.rows + 1);
  plotSums = grownInt(plotSums, size); laneSums = grownInt(laneSums, size); depositSums = grownInt(depositSums, size);
  if (marks.length < area.columns * area.rows) marks = new Uint8Array(area.columns * area.rows);
  for (let z = 0; z < area.rows; z++) for (let x = 0; x < area.columns; x++) {
    const worldX = area.minX + x, worldZ = area.minZ + z, cell = worldZ * cellsX + worldX;
    const fits = owned[cell] === 1 && context.occupied[cell] === 0 && !isWatchedRoadCell(watch, worldX, worldZ) &&
      foundationCellReason(world, cell, mine) === null;
    marks[z * area.columns + x] = fits ? 0 : 1;
  }
  fillSums(plotSums);
  for (let z = 0; z < area.rows; z++) for (let x = 0; x < area.columns; x++)
    marks[z * area.columns + x] = context.occupied[(area.minZ + z) * cellsX + area.minX + x] === 1 ? 1 : 0;
  fillSums(laneSums);
  if (!mine) return;
  for (let z = 0; z < area.rows; z++) for (let x = 0; x < area.columns; x++)
    marks[z * area.columns + x] = isDepositCell(world, (area.minZ + z) * cellsX + area.minX + x) ? 1 : 0;
  fillSums(depositSums);
};

/** Prepares the gentle-ground extremes of one turned footprint over `range` (not used by mines). */
export const preparePlotGround = (context: SettlementContext, range: CornerRange, width: number, depth: number) =>
  fillHeightExtremes(context, range, width, depth);

/** `passesPlotPrecheck` of the corner (left, top) from the prepared tables (the ground of the last footprint). */
export const passesScannedPlot = (context: SettlementContext, range: CornerRange, kind: number, left: number,
  top: number, width: number, depth: number) => {
  const { cellsX, cellsZ } = context.options.world;
  if (left + width >= cellsX || top + depth >= cellsZ) return false;
  if (rectSum(plotSums, left, top, left + width, top + depth) !== 0) return false;
  const laneLeft = left - PLOT_SPACING, laneTop = top - PLOT_SPACING;
  const spacing = width + 2 * PLOT_SPACING, rise = depth + 2 * PLOT_SPACING;
  if (rectSum(laneSums, laneLeft, laneTop, laneLeft + spacing, laneTop + rise) !== 0) return false;
  if (kind === PLOT_KIND_MINE) return rectSum(depositSums, left, top, left + width, top + depth) > 0;
  const corner = (top - range.minZ) * (range.maxX - range.minX + 1) + left - range.minX;
  return high[corner]! - low[corner]! <= PLOT_GENTLE_RISE;
};
