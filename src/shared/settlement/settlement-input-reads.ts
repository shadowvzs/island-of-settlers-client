import { NAVIGATION_BLOCK, type TileRect } from "../world/navigation-change-log";
import { NAVIGATION_HALO } from "./navigation-change-journal";

/**
 * JETTY-FRAMES: the tile bounds a computation reads while a recording runs, so a cached harbour
 * geometry (boat jetty, ship dock) knows which inputs its result depended on. Outside a recording
 * every note returns at once.
 *
 * A ground search reads the tiles of its start, goal and expanded nodes, each node's neighbour edges
 * (one node step, at most half a tile) and, from every sampled point, the A03 halo (trunk buckets,
 * segment props, building index reach, escape tests): `GROUND_READ_REACH` round each node. A memo
 * hit (A07) reads nothing now but answers for the blocks its original search read (already widened
 * by the halo); those blocks are recorded instead.
 */
export const GROUND_READ_REACH = 1 + NAVIGATION_HALO;

interface ReadBounds { empty: boolean; maxX: number; maxZ: number; minX: number; minZ: number }
/**
 * Everything read (terrain), what scans and ground searches read of the cell grids, and what ground
 * searches read (they alone consult settlement objects).
 */
interface Recording { all: ReadBounds; cells: ReadBounds; navigation: ReadBounds }

const emptyBounds = (): ReadBounds =>
  ({ empty: true, maxX: -Infinity, maxZ: -Infinity, minX: Infinity, minZ: Infinity });
let active: Recording | null = null;

const include = (bounds: ReadBounds, minX: number, minZ: number, maxX: number, maxZ: number) => {
  bounds.empty = false;
  bounds.minX = Math.min(bounds.minX, minX);
  bounds.minZ = Math.min(bounds.minZ, minZ);
  bounds.maxX = Math.max(bounds.maxX, maxX);
  bounds.maxZ = Math.max(bounds.maxZ, maxZ);
};

/** Records the terrain tiles (heights, slope, rocks, trunks) within `reach` whole tiles of the point's tile. */
export const noteInputRead = (x: number, z: number, reach: number) => {
  if (!active) return;
  const tileX = Math.floor(x), tileZ = Math.floor(z);
  include(active.all, tileX - reach, tileZ - reach, tileX + reach, tileZ + reach);
};

/** Records the terrain tiles of the segment's bounding box widened by `reach` whole tiles. */
export const noteInputSegment = (from: { x: number; z: number }, to: { x: number; z: number }, reach: number) => {
  if (!active) return;
  include(active.all, Math.floor(Math.min(from.x, to.x)) - reach, Math.floor(Math.min(from.z, to.z)) - reach,
    Math.floor(Math.max(from.x, to.x)) + reach, Math.floor(Math.max(from.z, to.z)) + reach);
};

/** A ground search node, start or goal. */
export const noteGroundSearchRead = (x: number, z: number) => {
  if (!active) return;
  const tileX = Math.floor(x), tileZ = Math.floor(z), reach = GROUND_READ_REACH;
  for (const bounds of [active.all, active.cells, active.navigation])
    include(bounds, tileX - reach, tileZ - reach, tileX + reach, tileZ + reach);
};

/** A reused cached value's reads count as read again by the computation that reused it. */
export const noteInputRects = (rects: { cells: TileRect | null; navigation: TileRect | null; terrain: TileRect }) => {
  if (!active) return;
  const pairs: [ReadBounds, TileRect | null][] =
    [[active.all, rects.terrain], [active.cells, rects.cells], [active.navigation, rects.navigation]];
  for (const [bounds, rect] of pairs) if (rect) include(bounds, rect.minX, rect.minZ, rect.maxX, rect.maxZ);
};

/** The journal blocks a reused negative ground search result depends on (A07 memo hit). */
export const noteGroundSearchBlocks = (cellsX: number, blocks: Int32Array) => {
  if (!active) return;
  const blocksX = Math.ceil(cellsX / NAVIGATION_BLOCK);
  for (const block of blocks) {
    const minX = (block % blocksX) * NAVIGATION_BLOCK, minZ = Math.floor(block / blocksX) * NAVIGATION_BLOCK;
    for (const bounds of [active.all, active.cells, active.navigation])
      include(bounds, minX, minZ, minX + NAVIGATION_BLOCK - 1, minZ + NAVIGATION_BLOCK - 1);
  }
};

const rectOf = (bounds: ReadBounds): TileRect | null => bounds.empty ? null :
  { maxX: bounds.maxX, maxZ: bounds.maxZ, minX: bounds.minX, minZ: bounds.minZ };
const merge = (target: ReadBounds, source: ReadBounds) => {
  if (!source.empty) include(target, source.minX, source.minZ, source.maxX, source.maxZ);
};

/**
 * Runs `run` and returns the tile rectangles it read: everything, the cell grids and what its ground
 * searches read (null: nothing was noted). Recordings nest: an outer recording also receives
 * everything an inner one read.
 */
export const recordInputReads = <Value>(run: () => Value):
  { cells: TileRect | null; navigation: TileRect | null; reads: TileRect | null; value: Value } => {
  const outer = active, own: Recording = { all: emptyBounds(), cells: emptyBounds(), navigation: emptyBounds() };
  active = own;
  let value: Value;
  try {
    value = run();
  } finally {
    active = outer;
    if (outer) {
      merge(outer.all, own.all);
      merge(outer.cells, own.cells);
      merge(outer.navigation, own.navigation);
    }
  }
  return { cells: rectOf(own.cells), navigation: rectOf(own.navigation), reads: rectOf(own.all), value };
};
