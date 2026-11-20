import { DMath } from "../math/deterministic-math";
import { ROAD_WIDTH, type RoadPoint, type RoadSegment } from "./road-types";

const pointKey = (point: RoadPoint) => `${point.x}:${point.z}`;
const sameDirection = (a: RoadPoint, b: RoadPoint, c: RoadPoint) => {
  const ax = b.x - a.x,
    az = b.z - a.z,
    bx = c.x - b.x,
    bz = c.z - b.z;
  return Math.abs(ax * bz - az * bx) < 1e-7 && ax * bx + az * bz > 0;
};

/** Fitted (narrowed or flaring) pieces keep their own ribbon widths. */
const isFitted = (segment: RoadSegment) => segment.startWidth !== undefined || segment.endWidth !== undefined;

/** Only presentation chains merge; graph edges and their upgrade receipts remain unchanged. */
export const compactRoadSegments = (segments: readonly RoadSegment[]): RoadSegment[] => {
  const adjacency = new Map<string, RoadSegment[]>();
  for (const segment of segments)
    for (const point of [segment.start, segment.end]) {
      const id = pointKey(point),
        neighbors = adjacency.get(id) ?? [];
      neighbors.push(segment);
      adjacency.set(id, neighbors);
    }
  const used = new Set<RoadSegment>();
  const extend = (origin: RoadPoint, end: RoadPoint, source: RoadSegment) => {
    let previous = source;
    while (!previous.doorway) {
      const neighbors = adjacency.get(pointKey(end));
      if (neighbors?.length !== 2) break;
      const next = neighbors.find((segment) => segment !== previous)!;
      if (used.has(next) || next.bridge || source.bridge || next.doorway || next.tier !== source.tier ||
        next.preview !== source.preview || isFitted(next) || isFitted(source)) break;
      const destination = pointKey(next.start) === pointKey(end) ? next.end : next.start;
      if (!sameDirection(origin, end, destination)) break;
      used.add(next);
      previous = next;
      end = destination;
    }
    return end;
  };
  const result: RoadSegment[] = [];
  for (const segment of segments) {
    if (used.has(segment)) continue;
    used.add(segment);
    const end = extend(segment.start, segment.end, segment);
    const start = extend(segment.end, segment.start, segment);
    result.push({ ...segment, start, end });
  }
  return result;
};

export const compactRoadPoints = (points: readonly RoadPoint[], protectedPrefix = 0) => {
  const result: RoadPoint[] = [];
  for (const point of points) {
    const last = result.at(-1);
    if (last && DMath.hypot(point.x - last.x, point.z - last.z) < 1e-7) continue;
    while (
      result.length > Math.max(1, protectedPrefix) &&
      sameDirection(result.at(-2)!, result.at(-1)!, point)
    )
      result.pop();
    result.push(point);
  }
  return result;
};

/** A bend stays within the union of the validated straight road corridors (centreline radius: half width). */
export const createRoadBend = (previous: RoadPoint, point: RoadPoint, next: RoadPoint, width = ROAD_WIDTH) => {
  const firstLength = DMath.hypot(previous.x - point.x, previous.z - point.z);
  const secondLength = DMath.hypot(next.x - point.x, next.z - point.z);
  if (firstLength < 1e-7 || secondLength < 1e-7) return null;
  const a = { x: (previous.x - point.x) / firstLength, z: (previous.z - point.z) / firstLength };
  const b = { x: (next.x - point.x) / secondLength, z: (next.z - point.z) / secondLength };
  const angle = DMath.acos(Math.max(-1, Math.min(1, a.x * b.x + a.z * b.z)));
  if (angle > Math.PI - 0.02 || angle < 0.1) return null;
  const tangent = DMath.tan(angle / 2);
  const trim = Math.min(width / 2 / tangent, firstLength * 0.48, secondLength * 0.48);
  const radius = trim * tangent;
  const bisector = DMath.hypot(a.x + b.x, a.z + b.z);
  const distance = trim / DMath.cos(angle / 2);
  const centre = {
    x: point.x + ((a.x + b.x) / bisector) * distance,
    z: point.z + ((a.z + b.z) / bisector) * distance
  };
  const start = { x: point.x + a.x * trim, z: point.z + a.z * trim };
  const end = { x: point.x + b.x * trim, z: point.z + b.z * trim };
  const startAngle = DMath.atan2(start.z - centre.z, start.x - centre.x);
  let sweep = DMath.atan2(end.z - centre.z, end.x - centre.x) - startAngle;
  if (sweep > Math.PI) sweep -= Math.PI * 2;
  if (sweep < -Math.PI) sweep += Math.PI * 2;
  return { centre, end, radius, start, startAngle, sweep };
};
