import type { SettlementTerritory } from "../settlement-territory";
import { createTransientMap } from "../settlement-transient-state";
import type { SettlementBuilding, SettlementContext } from "../settlement-types";
import { PLOT_RETEST_REACH, PLOT_ROTATIONS, PLOT_SOURCE_FIELDS } from "./constants";
import {
  buildClassEntries, type CornerRange, createClassEntries, type PlotClassEntries, type PlotSearch,
  retestClassEntries, sameClassEntries
} from "./plot-cache-entries";
import { comparePlotWatch, type DirtyRect, emptyPlotWatch, resetPlotWatch } from "./plot-cache-watch";
import { plotClassKey, plotClassOf } from "./plot-classes";
import { stampRoadStrips } from "./plot-road-mask";

/**
 * The candidate plot cache of one computer faction (plan §3.5): per plot class, the plots inside its territory
 * that pass the cheap pre-checks, sorted by distance to its home. It is derived and cold-equivalent (§3.1): it
 * is never saved, a load starts it empty (transient state) and the first decision rebuilds it; its contents
 * equal a rebuild from scratch at every decision, which the strict mode asserts.
 * - The territory's sources or the home moved: every class is rebuilt.
 * - Otherwise the watch names the changed cells since the last decision, and only the corners within reach of
 *   them are tested again.
 */
interface FactionPlotCache {
  classes: PlotClassEntries[];
  dirty: DirtyRect;
  /** The home's uid, then each territory source's uid, x, z and radius, as of the last rebuild. */
  identity: number[];
  search: PlotSearch;
}

/** Deterministic work counters (tests and the bench; never saved, never read by a decision). */
export const plotCacheWork = { classBuilds: 0, rebuilds: 0, retests: 0, strictChecks: 0 };

let strict = false;
/** The strict mode: every decision also rebuilds each class from scratch and throws when they differ. */
export const setPlotCacheStrict = (next: boolean) => {
  const previous = strict;
  strict = next;
  return previous;
};

const caches = createTransientMap<Map<number, FactionPlotCache>>();

const createCache = (): FactionPlotCache => ({
  classes: [], dirty: { maxX: -1, maxZ: -1, minX: 0, minZ: 0 }, identity: [],
  search: { homeX2: 0, homeZ2: 0, owned: new Uint8Array(0), span: 1, watch: emptyPlotWatch() }
});

const cacheOf = (context: SettlementContext, faction: number) => {
  let perFaction = caches.get(context);
  if (!perFaction) caches.set(context, perFaction = new Map());
  let cache = perFaction.get(faction);
  if (!cache) perFaction.set(faction, cache = createCache());
  return cache;
};

/** True when the home and the territory's sources are those of the last rebuild (no allocation). */
const sameIdentity = (cache: FactionPlotCache, home: SettlementBuilding, territory: SettlementTerritory) => {
  const { identity } = cache, { sources } = territory;
  if (identity.length !== 1 + sources.length * PLOT_SOURCE_FIELDS || identity[0] !== home.uid) return false;
  let at = 1;
  for (const { radius, uid, x, z } of sources) {
    if (identity[at++] !== uid || identity[at++] !== x) return false;
    if (identity[at++] !== z || identity[at++] !== radius) return false;
  }
  return true;
};

const rememberIdentity = (cache: FactionPlotCache, home: SettlementBuilding, territory: SettlementTerritory) => {
  cache.identity.length = 0;
  cache.identity.push(home.uid);
  for (const { radius, uid, x, z } of territory.sources) cache.identity.push(uid, x, z, radius);
};

const rebuild = (context: SettlementContext, cache: FactionPlotCache, home: SettlementBuilding,
  territory: SettlementTerritory) => {
  const { cellsX, cellsZ } = context.options.world;
  rememberIdentity(cache, home, territory);
  cache.search.homeX2 = Math.round(home.x * 2);
  cache.search.homeZ2 = Math.round(home.z * 2);
  cache.search.span = cellsX * cellsZ * PLOT_ROTATIONS;
  resetPlotWatch(context, territory.sources, cache.search.watch);
  for (const entries of cache.classes) buildClassEntries(context, cache.search, entries, cache.search.watch);
  plotCacheWork.rebuilds++;
};

/** The corners whose pre-check may read a cell of `dirty`, clamped to the watched window. */
const retestRange = (cache: FactionPlotCache, entries: PlotClassEntries): CornerRange => {
  const { dirty, search: { watch } } = cache, { depth, width } = entries.plotClass, reach = Math.max(width, depth);
  return { maxX: Math.min(watch.maxX, dirty.maxX + PLOT_RETEST_REACH),
    maxZ: Math.min(watch.maxZ, dirty.maxZ + PLOT_RETEST_REACH),
    minX: Math.max(watch.minX, dirty.minX - reach - PLOT_RETEST_REACH),
    minZ: Math.max(watch.minZ, dirty.minZ - reach - PLOT_RETEST_REACH) };
};

/** The strict mode: the road mask and every class equal what a rebuild from scratch gives now. */
const verifyStrict = (context: SettlementContext, cache: FactionPlotCache, faction: number) => {
  const { watch } = cache.search, roads = new Uint8Array(watch.roads.length);
  stampRoadStrips(context.options.roads, watch, roads);
  if (roads.some((road, index) => road !== watch.roads[index]))
    throw new Error(`Plot cache of faction ${faction} kept a stale road mask`);
  for (const entries of cache.classes) {
    const reference = createClassEntries(entries.key, entries.plotClass);
    buildClassEntries(context, cache.search, reference, watch, true);
    plotCacheWork.strictChecks++;
    if (!sameClassEntries(entries, reference))
      throw new Error(`Plot cache of faction ${faction} diverged from a rebuild (class ${entries.key})`);
  }
};

/** Brings the faction's cache up to date for this decision: a rebuild, a re-test of changed corners, or nothing. */
const refresh = (context: SettlementContext, cache: FactionPlotCache, faction: number,
  home: SettlementBuilding, territory: SettlementTerritory) => {
  cache.search.owned = territory.owned;
  if (!sameIdentity(cache, home, territory)) rebuild(context, cache, home, territory);
  else if (comparePlotWatch(context, cache.search.watch, cache.dirty)) {
    for (const entries of cache.classes)
      retestClassEntries(context, cache.search, entries, retestRange(cache, entries));
    plotCacheWork.retests++;
  }
  if (strict) verifyStrict(context, cache, faction);
};

/** The class of a type, built from scratch on its first request (its corners of the current window). */
const classEntriesOf = (context: SettlementContext, cache: FactionPlotCache, typeId: number) => {
  const key = plotClassKey(typeId);
  const existing = cache.classes.find(entries => entries.key === key);
  if (existing) return existing;
  const created = createClassEntries(key, plotClassOf(key));
  buildClassEntries(context, cache.search, created, cache.search.watch);
  cache.classes.push(created);
  plotCacheWork.classBuilds++;
  return created;
};

/** The faction's candidate plots for a building type as of now (sorted keys); once per planner decision. */
export const factionPlotEntries = (context: SettlementContext, faction: number, home: SettlementBuilding,
  territory: SettlementTerritory, typeId: number) => {
  const cache = cacheOf(context, faction);
  refresh(context, cache, faction, home, territory);
  return classEntriesOf(context, cache, typeId);
};
