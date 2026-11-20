import { NAVIGATION_BLOCK } from "../world/navigation-change-log";
import type { WorldData } from "../world/world-data";
import {
  areNavigationBlocksFresh,
  freshNavigationBlocksStamp,
  NAVIGATION_HALO,
  navigationInvalidation,
  shouldVerifyNavigationReuse
} from "./navigation-change-journal";
import { noteGroundSearchBlocks } from "./settlement-input-reads";
import { createTransientMap } from "./settlement-transient-state";
import type { SettlementContext, SettlementPoint } from "./settlement-types";

/**
 * A07: exact negative-result memo of the ground A* (docs/plans/a07-2026-11-08.md).
 *
 * A `no-path` or `budget-exhausted` search is kept with the journal blocks its predicates can have
 * read (every expanded node's tile, dilated by the step and the A03 halo) and the change revision
 * after observing them. The same search (same start, goal, step and budget; callers with predicate
 * callbacks never memoise) returns the kept result while none of those blocks changed, no global
 * invalidation followed, the road graph revision is equal and the occupancy, walking cost and
 * blocking bytes of those blocks are equal. Then the rerun would expand the very same nodes in the
 * same order and end the same way, so the memo changes work only, never a result.
 */
export type GroundSearchResult =
  | { path: SettlementPoint[]; status: "found"; visits: number }
  | { path: null; status: "budget-exhausted" | "no-path"; visits: number };
/** Expanded tiles of the search in progress (module scratch: one search runs at a time). */
export interface ExploredTiles {
  /** 1 for every tile in `tiles` (cleared again before the next search). */
  marks: Uint8Array;
  tiles: number[];
  width: number;
}
interface NegativeSearch {
  blocks: Int32Array;
  /** Occupancy, walking cost and blocking of every tile of `blocks` (64 bytes each, padded). */
  cells: Uint8Array;
  roads: number;
  stamp: number;
  status: "budget-exhausted" | "no-path";
  visits: number;
  world: WorldData;
}
interface MemoStore { bytes: number; entries: Map<string, NegativeSearch> }

/** Shorter failures cost about as much to rerun as to confirm. */
const MIN_MEMO_VISITS = 256;
const MAX_ENTRIES = 256;
const MAX_BYTES = 4 * 1024 * 1024;
const BLOCK_TILES = NAVIGATION_BLOCK * NAVIGATION_BLOCK;
const SNAPSHOT_LAYERS = 3;

let enabled = true;
/** Rollback switch; the memo is also off while navigation invalidation runs in the global mode. */
export const setGroundSearchMemo = (on: boolean) => {
  const previous = enabled;
  enabled = on;
  return previous;
};
const isMemoActive = () => enabled && navigationInvalidation().mode === "local";

/** Deterministic work counters (diagnostics and tests; never saved). */
export const groundSearchMemoWork = { evictions: 0, hits: 0, misses: 0, stale: 0, stores: 0, visitsSaved: 0 };
export const resetGroundSearchMemoWork = () => {
  for (const key of Object.keys(groundSearchMemoWork) as (keyof typeof groundSearchMemoWork)[])
    groundSearchMemoWork[key] = 0;
};

const stores = createTransientMap<MemoStore>();
const storeOf = (context: SettlementContext) => {
  let store = stores.get(context);
  if (!store) { store = { bytes: 0, entries: new Map() }; stores.set(context, store); }
  return store;
};
const entryBytes = (entry: NegativeSearch) => entry.blocks.byteLength + entry.cells.byteLength;
const forget = (store: MemoStore, key: string, entry: NegativeSearch) => {
  store.entries.delete(key);
  store.bytes -= entryBytes(entry);
};

let scratch: ExploredTiles | null = null;
let tracking = false;
/** Scratch for the next search's expanded tiles; null while another search tracks (nested search). */
const beginExplored = (world: WorldData): ExploredTiles | null => {
  if (tracking) return null;
  const size = world.cellsX * world.cellsZ;
  if (!scratch || scratch.marks.length !== size) scratch = { marks: new Uint8Array(size), tiles: [], width: 0 };
  for (const tile of scratch.tiles) scratch.marks[tile] = 0;
  scratch.tiles.length = 0;
  scratch.width = world.cellsX;
  tracking = true;
  return scratch;
};
/** Records the tile of a point the search reads from (clamped to the world). */
export const noteExploredPoint = (explored: ExploredTiles | null, x: number, z: number) => {
  if (!explored) return;
  const width = explored.width, height = explored.marks.length / width;
  const tile = Math.min(height - 1, Math.max(0, Math.floor(z))) * width +
    Math.min(width - 1, Math.max(0, Math.floor(x)));
  if (explored.marks[tile]) return;
  explored.marks[tile] = 1;
  explored.tiles.push(tile);
};

/**
 * The journal blocks within `reach` tiles of an explored tile. A read from a node reaches its
 * neighbours (one step) and, from every sampled point, the A03 halo (trunk buckets, segment props,
 * building index reach, escape tests).
 */
const exploredBlocks = (world: WorldData, explored: ExploredTiles, reach: number) => {
  const blocksX = Math.ceil(world.cellsX / NAVIGATION_BLOCK), blocksZ = Math.ceil(world.cellsZ / NAVIGATION_BLOCK);
  const seen = new Uint8Array(blocksX * blocksZ), blocks: number[] = [];
  for (const tile of explored.tiles) {
    const x = tile % world.cellsX, z = Math.floor(tile / world.cellsX);
    const fromX = Math.max(0, Math.floor((x - reach) / NAVIGATION_BLOCK));
    const toX = Math.min(blocksX - 1, Math.floor((x + reach) / NAVIGATION_BLOCK));
    const fromZ = Math.max(0, Math.floor((z - reach) / NAVIGATION_BLOCK));
    const toZ = Math.min(blocksZ - 1, Math.floor((z + reach) / NAVIGATION_BLOCK));
    for (let blockZ = fromZ; blockZ <= toZ; blockZ++)
      for (let blockX = fromX; blockX <= toX; blockX++) {
        const block = blockZ * blocksX + blockX;
        if (seen[block]) continue;
        seen[block] = 1;
        blocks.push(block);
      }
  }
  return Int32Array.from(blocks);
};

/** Occupancy, walking cost and blocking of the blocks' tiles: arrays no journal counter describes. */
const snapshotCells = (context: SettlementContext, blocks: Int32Array) => {
  const { world } = context.options, blocksX = Math.ceil(world.cellsX / NAVIGATION_BLOCK);
  const cells = new Uint8Array(blocks.length * BLOCK_TILES * SNAPSHOT_LAYERS);
  let write = 0;
  for (const block of blocks) {
    const minX = (block % blocksX) * NAVIGATION_BLOCK, minZ = Math.floor(block / blocksX) * NAVIGATION_BLOCK;
    for (let z = minZ; z < minZ + NAVIGATION_BLOCK; z++)
      for (let x = minX; x < minX + NAVIGATION_BLOCK; x++, write += SNAPSHOT_LAYERS) {
        if (x >= world.cellsX || z >= world.cellsZ) continue;
        const cell = z * world.cellsX + x;
        cells[write] = context.occupied[cell]!;
        cells[write + 1] = world.walkCost[cell]!;
        cells[write + 2] = world.blocking?.[cell] ?? 0;
      }
  }
  return cells;
};
const sameCells = (first: Uint8Array, second: Uint8Array) => {
  if (first.length !== second.length) return false;
  for (let index = 0; index < first.length; index++) if (first[index] !== second[index]) return false;
  return true;
};

const roadRevision = (context: SettlementContext) => context.options.roads?.revision ?? -1;
const isEntryFresh = (context: SettlementContext, entry: NegativeSearch) =>
  entry.world === context.options.world && entry.roads === roadRevision(context) &&
  areNavigationBlocksFresh(context, entry.blocks, entry.stamp) &&
  sameCells(entry.cells, snapshotCells(context, entry.blocks));

/** A kept result is rerun and compared (strict mode, and every few reuses in development builds). */
const verifyHit = (entry: NegativeSearch, run: (explored: ExploredTiles | null) => GroundSearchResult) => {
  if (!shouldVerifyNavigationReuse()) return;
  const fresh = run(null);
  if (fresh.status === entry.status && fresh.visits === entry.visits) return;
  throw new Error(`Stale ground search memo: kept ${entry.status}/${entry.visits}, ` +
    `now ${fresh.status}/${fresh.visits}`);
};

const lookup = (context: SettlementContext, key: string) => {
  const store = stores.get(context), entry = store?.entries.get(key);
  if (!store || !entry) return null;
  if (isEntryFresh(context, entry)) {
    // Most recently used last: eviction takes the oldest first.
    store.entries.delete(key);
    store.entries.set(key, entry);
    return entry;
  }
  groundSearchMemoWork.stale++;
  forget(store, key, entry);
  return null;
};

const remember = (context: SettlementContext, key: string, result: GroundSearchResult, explored: ExploredTiles,
  nodeStep: number) => {
  const { status } = result;
  if (status === "found") return;
  const { world } = context.options;
  const blocks = exploredBlocks(world, explored, Math.ceil(nodeStep) + NAVIGATION_HALO);
  const stamp = freshNavigationBlocksStamp(context, blocks);
  const entry: NegativeSearch = { blocks, cells: snapshotCells(context, blocks), roads: roadRevision(context),
    stamp, status, visits: result.visits, world };
  const store = storeOf(context), bytes = entryBytes(entry);
  if (bytes > MAX_BYTES) return;
  while (store.entries.size && (store.entries.size >= MAX_ENTRIES || store.bytes + bytes > MAX_BYTES)) {
    const [oldestKey, oldest] = store.entries.entries().next().value!;
    forget(store, oldestKey, oldest);
    groundSearchMemoWork.evictions++;
  }
  store.entries.set(key, entry);
  store.bytes += bytes;
  groundSearchMemoWork.stores++;
};

const runTracked = (context: SettlementContext, run: (explored: ExploredTiles | null) => GroundSearchResult) => {
  const explored = beginExplored(context.options.world);
  try {
    return { explored, result: run(explored) };
  } finally {
    if (explored) tracking = false;
  }
};

/**
 * Runs a callback-free ground search through the memo. `key` names the search exactly (start, goal,
 * node step, visit budget); `run` performs it, recording the tiles it expands into `explored`.
 */
export const memoisedGroundSearch = (context: SettlementContext, key: string, nodeStep: number,
  run: (explored: ExploredTiles | null) => GroundSearchResult): GroundSearchResult => {
  if (!isMemoActive()) return run(null);
  const known = lookup(context, key);
  if (known) {
    groundSearchMemoWork.hits++;
    groundSearchMemoWork.visitsSaved += known.visits;
    noteGroundSearchBlocks(known.world.cellsX, known.blocks);
    verifyHit(known, run);
    return { path: null, status: known.status, visits: known.visits };
  }
  groundSearchMemoWork.misses++;
  const { explored, result } = runTracked(context, run);
  if (explored && result.visits >= MIN_MEMO_VISITS) remember(context, key, result, explored, nodeStep);
  return result;
};
