import { distanceToSegment } from "./settlement-geometry";
import type { SettlementPoint } from "./settlement-types";

/** Bucket edge in tiles: a query with the usual clearances (≤ 1.2) reads at most 2 × 2 buckets. */
const BUCKET = 2;
/** Bucket key stride; far larger than any island's bucket count along x. */
const STRIDE = 65_536;
/** Widens the query box so a rounded distance just under the clearance still finds its bucket. */
const QUERY_MARGIN = 1e-6;

type Segment = { end: SettlementPoint; start: SettlementPoint };
interface RoadSource {
  revision?: number;
  segments?: () => readonly Segment[];
}
interface ProximityIndex {
  buckets: Map<number, Segment[]>;
  revision: number;
}

const bucketOf = (value: number) => Math.floor(value / BUCKET);

/** Every segment goes into each bucket its bounding box touches. */
const buildIndex = (segments: readonly Segment[], revision: number): ProximityIndex => {
  const buckets = new Map<number, Segment[]>();
  for (const segment of segments) {
    const { end, start } = segment;
    const toX = bucketOf(Math.max(start.x, end.x)), toZ = bucketOf(Math.max(start.z, end.z));
    for (let z = bucketOf(Math.min(start.z, end.z)); z <= toZ; z++)
      for (let x = bucketOf(Math.min(start.x, end.x)); x <= toX; x++) {
        const key = z * STRIDE + x, list = buckets.get(key);
        if (list) list.push(segment);
        else buckets.set(key, [segment]);
      }
  }
  return { buckets, revision };
};

const indices = new WeakMap<RoadSource, ProximityIndex>();
const indexOf = (roads: RoadSource, revision: number) => {
  const cached = indices.get(roads);
  if (cached?.revision === revision) return cached;
  const index = buildIndex(roads.segments?.() ?? [], revision);
  indices.set(roads, index);
  return index;
};

const nearAny = (segments: readonly Segment[], point: SettlementPoint, clearance: number) =>
  segments.some(({ end, start }) => distanceToSegment(point, start, end) < clearance);

/**
 * Within `clearance` of any road centreline. Exact: a segment closer than `clearance` has a point
 * inside the (slightly widened) query box, and that point lies in its bounding box, so it is in one of
 * the read buckets.
 * A road source without a revision cannot be cached and is scanned whole.
 */
export const isWithinRoadClearance = (roads: RoadSource, point: SettlementPoint, clearance: number) => {
  if (roads.revision === undefined) return nearAny(roads.segments?.() ?? [], point, clearance);
  const { buckets } = indexOf(roads, roads.revision);
  const reach = clearance + QUERY_MARGIN;
  const toX = bucketOf(point.x + reach), toZ = bucketOf(point.z + reach);
  for (let z = bucketOf(point.z - reach); z <= toZ; z++)
    for (let x = bucketOf(point.x - reach); x <= toX; x++) {
      const segments = buckets.get(z * STRIDE + x);
      if (segments && nearAny(segments, point, clearance)) return true;
    }
  return false;
};

/** An axis-aligned ground box in world cells. */
export interface RoadQueryBox {
  maxX: number;
  maxZ: number;
  minX: number;
  minZ: number;
}

/**
 * Whether `test` holds for a road whose bounding box meets `box`; roads elsewhere are never tested, a road may be
 * tested more than once. A road source without a revision cannot be cached and is scanned whole.
 */
export const someRoadInBox = (roads: RoadSource, box: RoadQueryBox, test: (segment: Segment) => boolean) => {
  if (roads.revision === undefined) return (roads.segments?.() ?? []).some(test);
  const { buckets } = indexOf(roads, roads.revision);
  const toX = bucketOf(box.maxX + QUERY_MARGIN), toZ = bucketOf(box.maxZ + QUERY_MARGIN);
  for (let z = bucketOf(box.minZ - QUERY_MARGIN); z <= toZ; z++)
    for (let x = bucketOf(box.minX - QUERY_MARGIN); x <= toX; x++)
      if (buckets.get(z * STRIDE + x)?.some(test)) return true;
  return false;
};
