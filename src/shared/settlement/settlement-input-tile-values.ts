import type { TileRect } from "../world/navigation-change-log";
import { shouldVerifyNavigationReuse } from "./navigation-change-journal";
import {
  captureTerrainInputs, changedTerrainTiles, clampInputRect, rectsIntersect, type TerrainInputCopy, unionInputRect
} from "./settlement-input-fingerprint";
import { noteInputRects, recordInputReads } from "./settlement-input-reads";
import type { SettlementContext } from "./settlement-types";

interface TileValue<Value> {
  /** The terrain tiles its computation read (null: none). */
  reads: TileRect | null;
  value: Value;
}

/**
 * PERF-FOLLOWUPS: many small values of one search (the board sites of each land foot of a boat
 * jetty), each kept with the terrain tiles it read. One terrain copy covers them all; after an edit
 * the copy's changed tiles renew only the values whose reads meet them. Values may read terrain only
 * (heights, lake vertices, slope, rocks, trunks): cell grids and settlement objects are not copied.
 */
export interface TileValues<Value> {
  copy: TerrainInputCopy | null;
  /** Some value was computed since the copy was taken. */
  pending: boolean;
  values: Map<number, TileValue<Value>>;
}

export const createTileValues = <Value>(): TileValues<Value> => ({ copy: null, pending: false, values: new Map() });

/** Drops every value whose reads meet a tile changed since the copy (call before a search pass). */
export const renewChangedTileValues = <Value>(context: SettlementContext, cache: TileValues<Value>) => {
  if (cache.pending) {
    // An interrupted pass computed values its copy does not cover.
    cache.values.clear();
    cache.pending = false;
  }
  if (!cache.copy) return;
  const changed = changedTerrainTiles(context, cache.copy);
  if (!changed.length) return;
  for (const [key, entry] of cache.values)
    if (entry.reads && changed.some(rect => rectsIntersect(rect, entry.reads!))) cache.values.delete(key);
  // The kept values still match the current terrain: the next settle copies it afresh.
  cache.copy = null;
};

const verifyKept = <Value>(kept: Value, compute: () => Value) => {
  const before = JSON.stringify(kept), now = JSON.stringify(compute());
  if (before !== now) throw new Error(`Stale tile value: kept ${before}, now ${now}`);
};

/**
 * The value under `key`, kept or computed. A kept value notes its reads for an enclosing recording;
 * strict mode (and every few reuses in development builds) recomputes it and throws on a difference.
 */
export const tileValue = <Value>(cache: TileValues<Value>, key: number, compute: () => Value): Value => {
  const known = cache.values.get(key);
  if (known) {
    if (known.reads) noteInputRects({ cells: null, navigation: null, terrain: known.reads });
    if (shouldVerifyNavigationReuse()) verifyKept(known.value, compute);
    return known.value;
  }
  const { reads, value } = recordInputReads(compute);
  cache.values.set(key, { reads, value });
  cache.pending = true;
  return value;
};

/** Takes the terrain copy for every kept value after a search pass that computed or renewed values. */
export const settleTileValues = <Value>(context: SettlementContext, cache: TileValues<Value>) => {
  if (!cache.pending && cache.copy) return;
  cache.pending = false;
  let rect: TileRect | null = null;
  for (const { reads } of cache.values.values()) if (reads) rect = rect ? unionInputRect(rect, reads) : reads;
  const terrain = rect && clampInputRect(context.options.world, rect);
  cache.copy = terrain ? captureTerrainInputs(context, terrain) : null;
};
