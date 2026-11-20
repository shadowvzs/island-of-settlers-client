import { MinHeap } from "../world/min-heap";

export type RoadPathVisit = (node: number, cost: number) => void;
export type RoadPathResult =
  | { status: "found"; cost: number; path: number[] }
  | { status: "no-path" | "search-limit" };
export const ROAD_SEARCH_LIMIT = 30000;

const reconstruct = (previous: Map<number, number>, start: number, end: number) => {
  const path = [end];
  while (path.at(-1) !== start) path.push(previous.get(path.at(-1)!)!);
  return path.reverse();
};

/**
 * Shared A* for constructing grid paths and routing over the connected road graph.
 * Neighbours are reported through a visitor, so expansion allocates no edge arrays.
 * `unreachable`, asked once per expansion, may prove that no path exists (the search then stops as "no-path").
 */
export const findRoadPath = (
  start: number,
  end: number,
  neighbours: (node: number, visit: RoadPathVisit) => void,
  estimate: (node: number) => number,
  limit = ROAD_SEARCH_LIMIT,
  unreachable?: () => boolean
): RoadPathResult => {
  const pending = new MinHeap(64);
  const distances = new Map([[start, 0]]);
  const previous = new Map<number, number>();
  const visited = new Set<number>();
  let current = start;
  const visit = (next: number, cost: number) => {
    if (visited.has(next)) return;
    const distance = distances.get(current)! + cost;
    if (distance >= (distances.get(next) ?? Infinity)) return;
    distances.set(next, distance);
    previous.set(next, current);
    pending.push(next, distance + estimate(next));
  };
  pending.push(start, estimate(start));
  while (pending.size && visited.size < limit) {
    current = pending.pop();
    if (visited.has(current)) continue;
    if (current === end)
      return { status: "found", cost: distances.get(current)!, path: reconstruct(previous, start, end) };
    visited.add(current);
    if (unreachable?.()) return { status: "no-path" };
    neighbours(current, visit);
  }
  return { status: pending.size ? "search-limit" : "no-path" };
};
