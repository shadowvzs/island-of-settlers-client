import type { WorldData } from "./world-data";

/**
 * Navigation change log (A03): a monotonic change revision per world and, per block of tiles, the
 * revision of the last change seen there. Navigation caches stamp each value with the revision at
 * which it was known fresh; a value is still fresh while no change in its read region (its tiles
 * plus the halo of its predicate) is newer than its stamp. An unexplained change raises the floor
 * instead: every value stamped before it is stale (the old global invalidation).
 */
export const NAVIGATION_BLOCK = 8;

/** Inclusive tile rectangle. */
export interface TileRect {
  maxX: number;
  maxZ: number;
  minX: number;
  minZ: number;
}

/** What the log reads of a world (road networks and tests pass narrower world objects). */
export type NavigationWorld = Pick<WorldData, "cellsX" | "cellsZ"> &
  Partial<Pick<WorldData, "buildRevision" | "props" | "terrainRevision">>;

interface WorldCounters {
  build: number;
  props: number;
  terrain: number;
}

interface NavigationChangeLog {
  blocks: Float64Array;
  blocksX: number;
  /** World counters as of the last explained change or check. */
  counters: WorldCounters;
  /** Nesting of explained changes: only the outermost one settles the counters. */
  depth: number;
  /** Values fresh before this revision are stale everywhere. */
  floor: number;
  revision: number;
  /** Unexplained world counter moves seen so far (the epoch of world-only caches). */
  unexplained: number;
}

const logs = new WeakMap<NavigationWorld, NavigationChangeLog>();

const countersOf = (world: NavigationWorld): WorldCounters =>
  ({ build: world.buildRevision ?? 0, props: world.props?.count ?? 0, terrain: world.terrainRevision ?? 0 });

const sameCounters = (first: WorldCounters, second: WorldCounters) =>
  first.build === second.build && first.props === second.props && first.terrain === second.terrain;

const logOf = (world: NavigationWorld) => {
  let log = logs.get(world);
  if (log) return log;
  const blocksX = Math.ceil(world.cellsX / NAVIGATION_BLOCK);
  log = { blocks: new Float64Array(blocksX * Math.ceil(world.cellsZ / NAVIGATION_BLOCK)), blocksX,
    counters: countersOf(world), depth: 0, floor: 0, revision: 0, unexplained: 0 };
  logs.set(world, log);
  return log;
};

/** The current change revision: a value computed now is fresh as of it. */
export const navigationChangeRevision = (world: NavigationWorld) => logOf(world).revision;

/** Something changed that no region describes: every value stamped before now is stale. */
export const invalidateWorldNavigation = (world: NavigationWorld) => {
  const log = logOf(world);
  log.floor = ++log.revision;
};

/** The blocks (inclusive block coordinates) a tile rectangle touches, clamped to the world. */
const blockRange = (world: Pick<WorldData, "cellsX" | "cellsZ">, rect: TileRect) => ({
  fromX: Math.max(0, Math.floor(rect.minX / NAVIGATION_BLOCK)),
  fromZ: Math.max(0, Math.floor(rect.minZ / NAVIGATION_BLOCK)),
  toX: Math.min(Math.floor((world.cellsX - 1) / NAVIGATION_BLOCK), Math.floor(rect.maxX / NAVIGATION_BLOCK)),
  toZ: Math.min(Math.floor((world.cellsZ - 1) / NAVIGATION_BLOCK), Math.floor(rect.maxZ / NAVIGATION_BLOCK))
});

/** The tiles of one block, clamped to the world. */
const blockRect = (world: Pick<WorldData, "cellsX" | "cellsZ">, blockX: number, blockZ: number): TileRect => ({
  maxX: Math.min(world.cellsX - 1, (blockX + 1) * NAVIGATION_BLOCK - 1),
  maxZ: Math.min(world.cellsZ - 1, (blockZ + 1) * NAVIGATION_BLOCK - 1),
  minX: blockX * NAVIGATION_BLOCK, minZ: blockZ * NAVIGATION_BLOCK
});

/** Marks a changed tile rectangle (clamped to the world) with a new revision. */
export const markNavigationChange = (world: NavigationWorld, rect: TileRect) => {
  const log = logOf(world), revision = ++log.revision;
  const { fromX, fromZ, toX, toZ } = blockRange(world, rect);
  for (let z = fromZ; z <= toZ; z++)
    for (let x = fromX; x <= toX; x++) log.blocks[z * log.blocksX + x] = revision;
};

/** World counters that moved without an explained change invalidate everything (true then). */
export const checkWorldNavigationCounters = (world: NavigationWorld) => {
  const log = logOf(world), live = countersOf(world);
  if (log.depth > 0 || sameCounters(log.counters, live)) return false;
  log.counters = live;
  log.unexplained++;
  invalidateWorldNavigation(world);
  return true;
};

/**
 * The epoch of caches that read only the world's props and blocking (obstacle index, prop edges,
 * road walkability): it moves with every unexplained world counter change, so a cache that holds
 * it needs only the block marks of the explained changes since its stamp.
 */
export const worldNavigationEpoch = (world: NavigationWorld) => {
  checkWorldNavigationCounters(world);
  return logOf(world).unexplained;
};

/**
 * Runs a world change whose whole navigation effect lies in `rect` (null: none). Revision bumps it
 * makes are explained; a counter that had already moved before it still invalidates everything.
 * The rectangle is marked before and after the change, so a cache read inside it sees the blocks
 * dirty as well. The first explained change of a world opens its log, so a cache first filled inside
 * that change does not take the change's own counter bumps for unexplained ones.
 */
export const explainWorldNavigationChange = <Result>(world: NavigationWorld, rect: TileRect | null,
  change: () => Result): Result => {
  const log = logOf(world);
  if (log.depth === 0) checkWorldNavigationCounters(world);
  if (rect) markNavigationChange(world, rect);
  log.depth++;
  try {
    return change();
  } finally {
    log.depth--;
    if (log.depth === 0) log.counters = countersOf(world);
    if (rect) markNavigationChange(world, rect);
  }
};

/** True while nothing in `rect` (clamped) changed after `stamp` and no invalidation followed it. */
export const isWorldNavigationRegionUnchanged = (world: NavigationWorld, rect: TileRect, stamp: number) => {
  const log = logOf(world);
  if (stamp < log.floor) return false;
  const { fromX, fromZ, toX, toZ } = blockRange(world, rect);
  for (let z = fromZ; z <= toZ; z++)
    for (let x = fromX; x <= toX; x++) if (log.blocks[z * log.blocksX + x]! > stamp) return false;
  return true;
};

/** True while no listed block (log block ids) changed after `stamp` and no invalidation followed it. */
export const isWorldNavigationBlockListUnchanged = (world: NavigationWorld, blocks: ArrayLike<number>,
  stamp: number) => {
  const log = logOf(world);
  if (stamp < log.floor) return false;
  for (let index = 0; index < blocks.length; index++) if (log.blocks[blocks[index]!]! > stamp) return false;
  return true;
};

/** The blocks of `rect` marked after `stamp`, as tile rectangles (the floor is not consulted). */
export const markedNavigationBlocks = (world: NavigationWorld, rect: TileRect, stamp: number): TileRect[] => {
  const log = logOf(world), { fromX, fromZ, toX, toZ } = blockRange(world, rect), changed: TileRect[] = [];
  for (let z = fromZ; z <= toZ; z++)
    for (let x = fromX; x <= toX; x++)
      if (log.blocks[z * log.blocksX + x]! > stamp) changed.push(blockRect(world, x, z));
  return changed;
};

/**
 * The blocks of `rect` that changed after `stamp`, as tile rectangles (empty: the region is fresh);
 * null when an invalidation followed `stamp`, so nothing stamped then can be kept.
 */
export const changedNavigationBlocks = (world: NavigationWorld, rect: TileRect, stamp: number) =>
  stamp < logOf(world).floor ? null : markedNavigationBlocks(world, rect, stamp);

/** The whole world as a tile rectangle. */
export const worldTileRect = (world: Pick<WorldData, "cellsX" | "cellsZ">): TileRect =>
  ({ maxX: world.cellsX - 1, maxZ: world.cellsZ - 1, minX: 0, minZ: 0 });

/** The single tile a prop stands on (its obstacle bucket and walk cost cell). */
export const propTileRect = (world: WorldData, prop: number): TileRect => {
  const x = Math.min(world.cellsX - 1, Math.max(0, Math.floor(world.props.x[prop]!)));
  const z = Math.min(world.cellsZ - 1, Math.max(0, Math.floor(world.props.z[prop]!)));
  return { maxX: x, maxZ: z, minX: x, minZ: z };
};
