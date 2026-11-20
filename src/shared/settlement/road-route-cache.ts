import type { RoadPoint, RoadRouteMetrics, RoadRouteSearch, RoadRouteStats } from "./road-types";

/** Hard cap: a full clear is cheaper and more predictable than LRU bookkeeping. */
const ROAD_ROUTE_CACHE_LIMIT = 1024;
/** Length fields hold one entry per road node, so fewer are kept. */
const ROAD_FIELD_CACHE_LIMIT = 128;

interface StoredRoute {
  search: RoadRouteSearch;
  points: readonly RoadPoint[];
}

const freezeSearch = (search: RoadRouteSearch): StoredRoute => {
  if (!search.route) return { search, points: [] };
  const points = Object.freeze(search.route.points.map((point) => Object.freeze(point)));
  return { search, points };
};

/** Callers own the returned array: prepared-travel bookkeeping keys on array identity. */
const copySearch = ({ points, search }: StoredRoute): RoadRouteSearch => {
  if (!search.route) return { status: search.status, route: null };
  return { status: search.status, route: { points: points.slice(), cost: search.route.cost,
    length: search.route.length } };
};

/** Logistics sorting needs totals only, so metrics hits skip the caller-owned points copy. */
const metricsOf = ({ search }: StoredRoute): RoadRouteMetrics => ({
  status: search.status,
  route: search.route && { cost: search.route.cost, length: search.route.length }
});

const sameSearch = (a: RoadRouteSearch, b: RoadRouteSearch) => {
  if (a.status !== b.status || !a.route !== !b.route) return false;
  if (!a.route || !b.route) return true;
  if (a.route.cost !== b.route.cost || a.route.points.length !== b.route.points.length) return false;
  return a.route.points.every((point, index) =>
    point.x === b.route!.points[index]!.x && point.z === b.route!.points[index]!.z);
};

/**
 * How a build (blocking) or occupancy revision change alone is checked (A03 part b, A04b): `affected`
 * names the memoized edge keys whose walkability may have changed (null: unknown, everything may
 * have), `walkable` recomputes one, `restamp` starts the change tracking afresh after a full clear.
 * Every route stays valid while no memoized edge flips, because a route is a function of the
 * walkability answers its search read.
 */
export interface WalkabilityRecheck {
  affected: (keys: readonly number[], occupancyChanged: boolean) => number[] | null;
  restamp: () => void;
  walkable: (key: number) => boolean;
}

/**
 * Memo of road searches keyed by an integer node pair and speed flag. Entries live until the road
 * graph or terrain revision changes, or a build (blocking) or occupancy change flips a memoized edge;
 * edge walkability is memoized under the same revisions. `verifyEvery` > 0 recomputes every n-th
 * hit: a stale entry throws when `strict` (tests), otherwise (development play) it is reported and
 * replaced by the fresh route.
 */
export const createRoadRouteCache = (verifyEvery: number, strict = true) => {
  const routes = new Map<number, StoredRoute>();
  const fields = new Map<number, ReadonlyMap<number, number>>();
  const walkableEdges = new Map<number, boolean>();
  const stats: RoadRouteStats = { calls: 0, hits: 0, misses: 0 };
  let roadRevision = -1;
  let occupancyRevision = -1;
  let terrainRevision = -1;
  let buildRevision = -1;
  let hitSerial = 0;
  const forget = () => {
    routes.clear();
    fields.clear();
    walkableEdges.clear();
  };
  /** True while every memoized edge the change may reach still answers as memoized. */
  const keepsWalkability = (recheck: WalkabilityRecheck, occupancyChanged: boolean) => {
    const keys = recheck.affected([...walkableEdges.keys()], occupancyChanged);
    if (!keys) return false;
    for (const key of keys) if (walkableEdges.get(key) !== recheck.walkable(key)) return false;
    return true;
  };
  /**
   * Grading changes slopes and a road graph change changes the edges: both clear everything. A
   * blocking or occupancy change keeps everything when `recheck` finds no flipped edge.
   */
  const synchronize = (roads: number, occupancy: number, terrain: number, build: number,
    recheck?: WalkabilityRecheck) => {
    if (roads === roadRevision && occupancy === occupancyRevision && terrain === terrainRevision &&
      build === buildRevision) return;
    const local = roads === roadRevision && terrain === terrainRevision && recheck !== undefined;
    const occupancyChanged = occupancy !== occupancyRevision;
    roadRevision = roads;
    occupancyRevision = occupancy;
    terrainRevision = terrain;
    buildRevision = build;
    if (local && keepsWalkability(recheck, occupancyChanged)) return;
    forget();
    recheck?.restamp();
  };
  const verifiedHit = (key: number, stored: StoredRoute, fresh: RoadRouteSearch): StoredRoute => {
    if (sameSearch(stored.search, fresh)) return stored;
    const message = `Stale road route cache entry ${key} at road revision ${roadRevision}`;
    if (strict) throw new Error(message);
    console.warn(message);
    // Kept routes and fields could have read the forgotten edge answers, so they cannot outlive them.
    forget();
    const entry = freezeSearch(fresh);
    routes.set(key, entry);
    return entry;
  };
  /**
   * `compute(true)` bypasses the edge memo, so a verification cannot reuse stale walkability.
   * Both presentations share the hit counter and verification schedule.
   */
  const lookup = <T>(
    key: number, compute: (fresh: boolean) => RoadRouteSearch, present: (entry: StoredRoute) => T
  ): T => {
    stats.calls++;
    const stored = routes.get(key);
    if (stored) {
      stats.hits++;
      if (verifyEvery > 0 && ++hitSerial % verifyEvery === 0)
        return present(verifiedHit(key, stored, compute(true)));
      return present(stored);
    }
    stats.misses++;
    if (routes.size >= ROAD_ROUTE_CACHE_LIMIT) routes.clear();
    const entry = freezeSearch(compute(false));
    routes.set(key, entry);
    return present(entry);
  };
  const search = (key: number, compute: (fresh: boolean) => RoadRouteSearch) =>
    lookup(key, compute, copySearch);
  const metrics = (key: number, compute: (fresh: boolean) => RoadRouteSearch) =>
    lookup(key, compute, metricsOf);
  const walkable = (key: number, compute: () => boolean) => {
    const known = walkableEdges.get(key);
    if (known !== undefined) return known;
    const result = compute();
    walkableEdges.set(key, result);
    return result;
  };
  /**
   * A04d length fields live exactly as long as the routes: they read edge walkability through the
   * same memo, so the same revision and recheck rules keep or clear them.
   */
  const field = (key: number, compute: () => ReadonlyMap<number, number>) => {
    const known = fields.get(key);
    if (known) return known;
    if (fields.size >= ROAD_FIELD_CACHE_LIMIT) fields.clear();
    const result = compute();
    fields.set(key, result);
    return result;
  };
  /** Uncached searches still count, so benches compare like with like. */
  const countUncached = () => {
    stats.calls++;
    stats.misses++;
  };
  return {
    countUncached, field, metrics, search, stats: (): RoadRouteStats => ({ ...stats }), synchronize, walkable
  };
};

/** Connected-component labels over the raw adjacency, rebuilt once per road revision. */
export const createRoadComponents = () => {
  let labels = new Map<number, number>();
  let labelledRevision = -1;
  const label = (adjacency: ReadonlyMap<number, ReadonlyMap<number, unknown>>) => {
    labels = new Map();
    let component = 0;
    const pending: number[] = [];
    for (const start of adjacency.keys()) {
      if (labels.has(start)) continue;
      labels.set(start, component);
      pending.push(start);
      while (pending.length) {
        for (const next of adjacency.get(pending.pop()!)?.keys() ?? []) {
          if (labels.has(next)) continue;
          labels.set(next, component);
          pending.push(next);
        }
      }
      component++;
    }
  };
  /** False only for a pair no edge sequence can join, so A* would exhaust a whole component. */
  const connected = (
    adjacency: ReadonlyMap<number, ReadonlyMap<number, unknown>>, revision: number, a: number, b: number
  ) => {
    if (labelledRevision !== revision) {
      label(adjacency);
      labelledRevision = revision;
    }
    return labels.get(a) === labels.get(b);
  };
  return { connected };
};
