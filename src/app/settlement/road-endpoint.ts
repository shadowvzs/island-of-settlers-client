import {
  ROAD_GRID_STEP,
  type RoadPoint,
  type RoadSegment
} from "../../shared/settlement/road-types";

const key = (point: RoadPoint) => `${point.x}:${point.z}`;

/** Prefer joining a nearby separate road over ending half a cell short of its visible surface. */
export const snapExistingRoadEndpoint = (
  point: RoadPoint,
  sections: readonly Pick<RoadSegment, "start" | "end">[],
  start: RoadPoint | null
): RoadPoint | null => {
  const nodes = new Map<string, RoadPoint>(),
    edges = new Map<string, Set<string>>();
  for (const section of sections) {
    const a = key(section.start),
      b = key(section.end);
    nodes.set(a, section.start);
    nodes.set(b, section.end);
    if (!edges.has(a)) edges.set(a, new Set());
    if (!edges.has(b)) edges.set(b, new Set());
    edges.get(a)!.add(b);
    edges.get(b)!.add(a);
  }
  const connected = new Set<string>(),
    pending = start ? [key(start)] : [];
  while (pending.length) {
    const current = pending.pop()!;
    if (connected.has(current)) continue;
    connected.add(current);
    for (const neighbor of edges.get(current) ?? []) pending.push(neighbor);
  }
  let nearest: RoadPoint | null = null,
    distance = ROAD_GRID_STEP + 0.05;
  let separate: RoadPoint | null = null,
    separateDistance = distance;
  for (const [node, candidate] of nodes) {
    const gap = Math.hypot(point.x - candidate.x, point.z - candidate.z);
    if (gap < distance) {
      nearest = candidate;
      distance = gap;
    }
    if (start && !connected.has(node) && gap < separateDistance) {
      separate = candidate;
      separateDistance = gap;
    }
  }
  const target = separate ?? nearest;
  return target && { ...target };
};
