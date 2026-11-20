import { BLOCKING, type WorldData } from "../../world/world-data";
import type { SettlementContext } from "../settlement-types";
import {
  PLOT_WATCH_GROUND_BITS, PLOT_WATCH_GROUND_SHIFT, PLOT_WATCH_MARGIN, PLOT_WATCH_OCCUPIED_BITS, PLOT_WATCH_ROAD,
  PLOT_WATCH_SLOPE_BITS, PLOT_WATCH_SLOPE_SHIFT, PLOT_WATCH_WATER_OR_CLIFF
} from "./constants";
import { stampRoadStrips } from "./plot-road-mask";

/**
 * What the candidate cache's pre-checks read, watched over the faction's territory window (plan §3.5
 * incremental invalidation). `occupied` has some twenty writers and the A03 journal sees a building claim as an
 * unexplained counter move (a global floor), so neither the journal nor the claim bounds alone name every changed
 * cell. The watch keeps a copy of the read layers instead and compares it at each decision: a tight loop over
 * the window that returns the exact changed rectangle, whatever wrote it. Roads are stamped into a cell mask only
 * when the network's revision moves (they reserve plots without marking `occupied`).
 */
export interface PlotWatch {
  /** Per window cell: `occupied` (0-3), water/cliff blocking, slope and ground class, road strip, packed. */
  cells: Uint16Array;
  /** Per window vertex: the height. */
  heights: Float32Array;
  maxX: number;
  maxZ: number;
  minX: number;
  minZ: number;
  /** The road network revision `roads` was stamped at (-1: never). */
  roadRevision: number;
  /** Per window cell: 1 inside a road's reserved stone width (what the pre-check reads). */
  roads: Uint8Array;
}

/** The changed cells of the last comparison (vertex x/z count as the cell x/z), inclusive; empty: minX > maxX. */
export interface DirtyRect {
  maxX: number;
  maxZ: number;
  minX: number;
  minZ: number;
}

const cellCode = (context: SettlementContext, world: WorldData, cell: number, road: number) => {
  const blocking = world.blocking[cell];
  const ground = world.buildCap?.[cell] ?? world.buildClass[cell]!;
  const waterOrCliff = blocking === BLOCKING.water || blocking === BLOCKING.cliff ? PLOT_WATCH_WATER_OR_CLIFF : 0;
  return Math.min(PLOT_WATCH_OCCUPIED_BITS, context.occupied[cell]!) | waterOrCliff |
    ((world.slopeClass?.[cell] ?? 0) & PLOT_WATCH_SLOPE_BITS) << PLOT_WATCH_SLOPE_SHIFT |
    (ground & PLOT_WATCH_GROUND_BITS) << PLOT_WATCH_GROUND_SHIFT | road * PLOT_WATCH_ROAD;
};

export const emptyPlotWatch = (): PlotWatch => ({ cells: new Uint16Array(0), heights: new Float32Array(0),
  maxX: -1, maxZ: -1, minX: 0, minZ: 0, roadRevision: -1, roads: new Uint8Array(0) });

/** The territory's cell bounds (from its sources' circles) with the reach of every pre-check read. */
const watchBounds = (world: WorldData, sources: readonly { radius: number; x: number; z: number }[],
  watch: PlotWatch) => {
  watch.minX = world.cellsX; watch.minZ = world.cellsZ; watch.maxX = -1; watch.maxZ = -1;
  for (const { radius, x, z } of sources) {
    watch.minX = Math.min(watch.minX, Math.floor(x - radius) - PLOT_WATCH_MARGIN);
    watch.minZ = Math.min(watch.minZ, Math.floor(z - radius) - PLOT_WATCH_MARGIN);
    watch.maxX = Math.max(watch.maxX, Math.ceil(x + radius) + PLOT_WATCH_MARGIN);
    watch.maxZ = Math.max(watch.maxZ, Math.ceil(z + radius) + PLOT_WATCH_MARGIN);
  }
  watch.minX = Math.max(0, watch.minX); watch.minZ = Math.max(0, watch.minZ);
  watch.maxX = Math.min(world.cellsX - 1, watch.maxX); watch.maxZ = Math.min(world.cellsZ - 1, watch.maxZ);
};

const windowWidth = (watch: PlotWatch) => watch.maxX - watch.minX + 1;
const windowDepth = (watch: PlotWatch) => watch.maxZ - watch.minZ + 1;

/** Stamps the road mask again when the network changed since (or `force`: a moved window). */
const refreshRoads = (context: SettlementContext, watch: PlotWatch, force: boolean) => {
  const { roads } = context.options, revision = roads.revision ?? -1;
  if (!force && revision >= 0 && revision === watch.roadRevision) return;
  watch.roadRevision = revision;
  stampRoadStrips(roads, watch, watch.roads);
};

/** True when the window cell (x, z) lies inside a road's reserved stone width (world cells inside the window). */
export const isWatchedRoadCell = (watch: PlotWatch, x: number, z: number) =>
  watch.roads[(z - watch.minZ) * windowWidth(watch) + x - watch.minX] === 1;

/** Re-centres the watch on the territory and copies the read layers (a full cache rebuild). */
export const resetPlotWatch = (context: SettlementContext, sources: readonly { radius: number; x: number;
  z: number }[], watch: PlotWatch) => {
  const { world } = context.options;
  watchBounds(world, sources, watch);
  const width = Math.max(0, windowWidth(watch)), depth = Math.max(0, windowDepth(watch));
  if (watch.cells.length < width * depth) {
    watch.cells = new Uint16Array(width * depth);
    watch.roads = new Uint8Array(width * depth);
  }
  if (watch.heights.length < (width + 1) * (depth + 1)) watch.heights = new Float32Array((width + 1) * (depth + 1));
  refreshRoads(context, watch, true);
  for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) watch.cells[z * width + x] =
    cellCode(context, world, (watch.minZ + z) * world.cellsX + watch.minX + x, watch.roads[z * width + x]!);
  for (let z = 0; z <= depth; z++) for (let x = 0; x <= width; x++)
    watch.heights[z * (width + 1) + x] = world.heights[(watch.minZ + z) * (world.cellsX + 1) + watch.minX + x]!;
};

const extend = (dirty: DirtyRect, x: number, z: number) => {
  if (x < dirty.minX) dirty.minX = x;
  if (x > dirty.maxX) dirty.maxX = x;
  if (z < dirty.minZ) dirty.minZ = z;
  if (z > dirty.maxZ) dirty.maxZ = z;
};

/**
 * Compares the live layers with the watch's copy, refreshes the copy and writes the changed rectangle into
 * `dirty` (world cells). Returns whether anything changed. Allocation-free.
 */
export const comparePlotWatch = (context: SettlementContext, watch: PlotWatch, dirty: DirtyRect) => {
  const { world } = context.options;
  dirty.minX = world.cellsX; dirty.minZ = world.cellsZ; dirty.maxX = -1; dirty.maxZ = -1;
  const width = windowWidth(watch), depth = windowDepth(watch);
  if (width <= 0 || depth <= 0) return false;
  refreshRoads(context, watch, false);
  for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) {
    const cell = (watch.minZ + z) * world.cellsX + watch.minX + x;
    const code = cellCode(context, world, cell, watch.roads[z * width + x]!);
    if (watch.cells[z * width + x] === code) continue;
    watch.cells[z * width + x] = code;
    extend(dirty, watch.minX + x, watch.minZ + z);
  }
  for (let z = 0; z <= depth; z++) for (let x = 0; x <= width; x++) {
    const height = world.heights[(watch.minZ + z) * (world.cellsX + 1) + watch.minX + x]!;
    if (watch.heights[z * (width + 1) + x] === height) continue;
    watch.heights[z * (width + 1) + x] = height;
    extend(dirty, watch.minX + x, watch.minZ + z);
  }
  return dirty.maxX >= dirty.minX;
};
