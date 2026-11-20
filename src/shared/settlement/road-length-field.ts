import { DMath } from "../math/deterministic-math";
import { MinHeap } from "../world/min-heap";
import { ROAD_SEARCH_LIMIT } from "./road-pathfinding";
import type { RoadPoint, RoadSegment } from "./road-types";

/**
 * Walked length to one target node, by start node; a missing node cannot reach the target. `null`
 * from `RoadNetwork.lengthField`: no field for this target (the caller searches every route itself).
 */
export type RoadLengthField = (start: RoadPoint) => number;

/**
 * A04d: the shortest walked length (sum of node-to-node distances) from every road node to `target`
 * over the edges a route search may use. Dijkstra runs backwards, so `usable(from, to)` is asked in
 * the direction a search from `from` would ask it. Reachability is exact; the length is a lower
 * bound of any found route's walked length, because a route minimises travel time, not length.
 */
export const roadLengthField = (
  target: number,
  adjacency: ReadonlyMap<number, ReadonlyMap<number, RoadSegment>>,
  usable: (from: number, to: number, segment: RoadSegment) => boolean,
  point: (node: number) => RoadPoint
): ReadonlyMap<number, number> => {
  const distances = new Map([[target, 0]]);
  const settled = new Set<number>();
  const pending = new MinHeap(64);
  pending.push(target, 0);
  while (pending.size) {
    const current = pending.pop();
    if (settled.has(current)) continue;
    settled.add(current);
    const here = point(current), reached = distances.get(current)!;
    for (const [previous, segment] of adjacency.get(current) ?? []) {
      if (settled.has(previous) || !usable(previous, current, segment)) continue;
      const from = point(previous);
      const distance = reached + DMath.hypot(here.x - from.x, here.z - from.z);
      if (distance >= (distances.get(previous) ?? Infinity)) continue;
      distances.set(previous, distance);
      pending.push(previous, distance);
    }
  }
  return distances;
};

/** What a road network shares with its length fields: its graph, node mapping and route cache. */
export interface RoadLengthFieldSource {
  adjacency: ReadonlyMap<number, ReadonlyMap<number, RoadSegment>>;
  /** The route cache's field store: same lifetime as the cached routes. */
  field: (key: number, compute: () => ReadonlyMap<number, number>) => ReadonlyMap<number, number>;
  memoizes: () => boolean;
  node: (point: RoadPoint) => number;
  point: (node: number) => RoadPoint;
  /** Brings the route cache up to the current revisions (keeps or clears it). */
  synchronize: () => void;
  /** One cached-walkability travel step of an any-tier route search. */
  usable: (from: number, to: number, segment: RoadSegment) => boolean;
  validPoint: (point: RoadPoint) => boolean;
}

/**
 * `RoadNetwork.lengthField`: `field(start)` is finite exactly when `route(start, end)` finds a route,
 * and then at most that route's walked length. Null when routes are not memoized (a live blocker
 * without a revision) or when a route search could stop at its node budget before exhausting the
 * network, because reachability would then no longer decide whether a route is found.
 */
export const createRoadLengthFields = (source: RoadLengthFieldSource) =>
  (end: RoadPoint): RoadLengthField | null => {
    const { adjacency, node, validPoint } = source;
    if (!validPoint(end) || !source.memoizes() || adjacency.size >= ROAD_SEARCH_LIMIT) return null;
    const last = node(end);
    if (!adjacency.has(last)) return () => Infinity;
    source.synchronize();
    const distances = source.field(last, () => roadLengthField(last, adjacency, source.usable, source.point));
    return (start: RoadPoint) => {
      if (!validPoint(start)) return Infinity;
      const first = node(start);
      if (!adjacency.has(first)) return Infinity;
      return distances.get(first) ?? Infinity;
    };
  };
