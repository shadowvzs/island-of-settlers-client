import { firstCorridorStandingPoint } from "./building-navigation-corridor";
import { routeRevision } from "./military-route-revision";
import {
  freshNavigationStamp,
  haloRect,
  invalidateNavigationIfGlobal,
  isNavigationRegionFresh,
  navigationJournalWork,
  type NavigationReads,
  navigationRevisionNow,
  READ_NONE,
  READ_TRUE,
  recordRiderTileRead,
  shouldVerifyNavigationReuse
} from "./navigation-change-journal";
import { hasBuildingNavigationNearby } from "./settlement-building-navigation";
import { isMountedNavigationClear } from "./settlement-navigation";
import type { SettlementContext } from "./settlement-types";

/**
 * Per tile, whether a horse fits at its centre (trees and rocks too). Before A03 every route
 * revision began a new all-unknown array. Now a revision change begins a new epoch instead: a tile
 * first read in an epoch keeps its value when nothing in its read region (the tile plus
 * `NAVIGATION_HALO`) changed since it was known fresh, and is recomputed otherwise. Within an epoch
 * a value read once is kept, exactly as the old array kept it.
 */
export interface RiderTiles {
  clear: (tile: number) => boolean;
}

/** One epoch's view, for a lingering reader (a lazy flood) that outlives the epoch. */
interface RiderView { snapshot: Uint8Array | null }
interface RiderStore {
  epoch: number;
  /** Epoch in which each tile was last read (0: never). */
  epochs: Uint32Array;
  key: string;
  /** A lingering reader holds the current view: freeze it at the next boundary. */
  lingering: boolean;
  /** Revision at which each tile's value was last known fresh. */
  stamps: Float64Array;
  /** 0: unknown, 1: a horse fits, 2: it does not. */
  values: Uint8Array;
  view: RiderView;
}

/**
 * Keyed by the context object like the pre-A03 array: a scratch context copy has its own tiles, and
 * an in-place reload keeps the epoch's tiles while the route revision holds.
 */
const stores = new WeakMap<SettlementContext, RiderStore>();

const riderTileRect = (context: SettlementContext, tile: number) => {
  const width = context.options.world.cellsX, x = tile % width, z = Math.floor(tile / width);
  return haloRect(context, x, z, x, z);
};
/** The tile centre (or, beside a building, one of its standing points) has a horse's clearance. */
export const isRiderTileClear = (context: SettlementContext, tile: number) => {
  const width = context.options.world.cellsX;
  const point = { x: tile % width + .5, z: Math.floor(tile / width) + .5 };
  return isMountedNavigationClear(context, point) || (hasBuildingNavigationNearby(context, point) &&
    firstCorridorStandingPoint(context, point, true) !== undefined);
};

/** What the old per-epoch array held at the boundary: only the tiles read in that epoch. */
const epochSnapshot = (store: RiderStore) => {
  const snapshot = new Uint8Array(store.values.length);
  for (let tile = 0; tile < snapshot.length; tile++)
    if (store.epochs[tile] === store.epoch) snapshot[tile] = store.values[tile]!;
  return snapshot;
};
const beginEpoch = (context: SettlementContext, store: RiderStore, key: string) => {
  store.key = key;
  if (store.lingering) store.view.snapshot = epochSnapshot(store);
  store.lingering = false;
  store.view = { snapshot: null };
  store.epoch++;
  invalidateNavigationIfGlobal(context);
};
/** The rider tile store at the current route revision (a revision change is an epoch boundary). */
const riderStore = (context: SettlementContext) => {
  const key = routeRevision(context);
  const store = stores.get(context);
  if (store) {
    if (store.key !== key) beginEpoch(context, store, key);
    return store;
  }
  const cells = context.options.world.cellsX * context.options.world.cellsZ;
  const created: RiderStore = { epoch: 1, epochs: new Uint32Array(cells), key, lingering: false,
    stamps: new Float64Array(cells), values: new Uint8Array(cells), view: { snapshot: null } };
  stores.set(context, created);
  return created;
};

const verifyKept = (context: SettlementContext, tile: number, clear: boolean) => {
  if (shouldVerifyNavigationReuse() && isRiderTileClear(context, tile) !== clear)
    throw new Error(`Stale rider tile ${tile}: kept ${clear} across a navigation change`);
};
const storedClear = (context: SettlementContext, store: RiderStore, tile: number) => {
  const value = store.values[tile]!;
  if (value && store.epochs[tile] === store.epoch) {
    recordRiderTileRead(tile, value === 1, store.stamps[tile]!);
    return value === 1;
  }
  const rect = riderTileRect(context, tile);
  if (value && isNavigationRegionFresh(context, rect, store.stamps[tile]!)) {
    verifyKept(context, tile, value === 1);
    navigationJournalWork.riderKeeps++;
    store.epochs[tile] = store.epoch;
    store.stamps[tile] = navigationRevisionNow(context);
  } else {
    navigationJournalWork.riderComputes++;
    store.stamps[tile] = freshNavigationStamp(context, rect);
    store.values[tile] = isRiderTileClear(context, tile) ? 1 : 2;
    store.epochs[tile] = store.epoch;
  }
  recordRiderTileRead(tile, store.values[tile] === 1, store.stamps[tile]!);
  return store.values[tile] === 1;
};
/** After a boundary a lingering reader keeps its epoch's array, filled lazily like before. */
const snapshotClear = (context: SettlementContext, snapshot: Uint8Array, tile: number) => {
  if (!snapshot[tile]) snapshot[tile] = isRiderTileClear(context, tile) ? 1 : 2;
  return snapshot[tile] === 1;
};

/**
 * The rider tiles at the current route revision. `lingering`: the reader keeps them beyond this
 * synchronous call (a lazy flood), so it sees its own epoch's values even after a boundary.
 */
export const riderTiles = (context: SettlementContext, lingering = false): RiderTiles => {
  const store = riderStore(context);
  if (!lingering) return { clear: tile => storedClear(context, store, tile) };
  store.lingering = true;
  const view = store.view;
  return { clear: tile => view.snapshot ? snapshotClear(context, view.snapshot, tile) : storedClear(context, store, tile) };
};

/**
 * A flow field kept or shared at a boundary stands in for the rebuild that would have read these
 * tiles now: they count as read in this epoch. A tile near a changed block (`isDirty`) is read for
 * real and must answer as recorded. False when a tile is gone or answers differently (the field
 * must be rebuilt).
 */
export const touchRiderTiles = (context: SettlementContext, reads: NavigationReads,
  isDirty: ((cell: number) => boolean) | null) => {
  const store = riderStore(context), now = navigationRevisionNow(context);
  const { box, cellsX, rider } = reads;
  for (let cell = 0; cell < rider.length; cell++) {
    const read = rider[cell]!;
    if (read === READ_NONE) continue;
    const tile = (box.minZ + Math.floor(cell / box.width)) * cellsX + box.minX + cell % box.width;
    if (isDirty?.(cell)) {
      if (storedClear(context, store, tile) !== (read === READ_TRUE)) return false;
      continue;
    }
    if (!store.values[tile]) return false;
    if (store.epochs[tile] === store.epoch) continue;
    store.epochs[tile] = store.epoch;
    store.stamps[tile] = now;
  }
  return true;
};
