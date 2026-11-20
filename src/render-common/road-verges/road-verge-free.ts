import type { RoadSegment } from "../../shared/settlement/road-types";
import { TWO_LANE_CART_HALF_WIDTH } from "../logistics/handcart-rules";
import { ROAD_VERGE_MAX_WIDENING, roadVergeWidening } from "./road-verge-bands";
import type { RoadVergeFreeTest } from "./road-verge-placement";

/** Axis-aligned ground rectangle (world units) a verge plant must keep out of. */
export interface VergeBlockedRect { maxX: number; maxZ: number; minX: number; minZ: number }

export interface RoadVergeObstacles {
  /** Building plots, field sites and decoration supports. */
  blocked: readonly VergeBlockedRect[];
  /** Water and ground that grows no meadow. */
  isBare: (x: number, z: number) => boolean;
  /** Every completed road, door lane and bridge (previews are ignored). */
  roads: readonly RoadSegment[];
}

/** Largest plant reach the plot buckets must cover (a band C herb at full placement scale). */
const MAX_REACH = .35;
/** Turning carts sweep this far round a crossing (`decorationClearsRoadTraffic` pockets); herbs stay out. */
const JUNCTION_POCKET = 1.4;
const BUCKET = 2;

const bucketKey = (x: number, z: number) => Math.floor(x / BUCKET) * 65536 + Math.floor(z / BUCKET);

/** How far a plant centre must keep from a road: the two-lane clearance, out past any flare or deck. */
const roadClearanceGap = (x: number, z: number, road: RoadSegment) => {
  const dx = road.end.x - road.start.x, dz = road.end.z - road.start.z, length = dx * dx + dz * dz;
  const t = length ? Math.max(0, Math.min(1, ((x - road.start.x) * dx + (z - road.start.z) * dz) / length)) : 0;
  const distance = Math.hypot(x - road.start.x - dx * t, z - road.start.z - dz * t);
  return distance - TWO_LANE_CART_HALF_WIDTH - roadVergeWidening(road, t);
};

/** Buckets each item into every BUCKET-cell it can reach within `pad`. */
const createBuckets = <T>(items: readonly T[], bounds: (item: T) => VergeBlockedRect, pad: number) => {
  const buckets = new Map<number, T[]>();
  for (const item of items) {
    const box = bounds(item);
    for (let x = Math.floor((box.minX - pad) / BUCKET); x <= Math.floor((box.maxX + pad) / BUCKET); x++)
      for (let z = Math.floor((box.minZ - pad) / BUCKET); z <= Math.floor((box.maxZ + pad) / BUCKET); z++) {
        const key = x * 65536 + z, bucket = buckets.get(key);
        if (bucket) bucket.push(item); else buckets.set(key, [item]);
      }
  }
  return buckets;
};

const segmentBounds = (road: RoadSegment): VergeBlockedRect => ({
  maxX: Math.max(road.start.x, road.end.x), maxZ: Math.max(road.start.z, road.end.z),
  minX: Math.min(road.start.x, road.end.x), minZ: Math.min(road.start.z, road.end.z)
});

/** Crossings where both road axes meet: the turning pockets of two-lane cart traffic. */
const junctionNodes = (roads: readonly RoadSegment[]) => {
  const axes = new Map<string, { axes: number; x: number; z: number }>();
  for (const road of roads) {
    if (road.doorway) continue;
    for (const point of [road.start, road.end]) {
      const key = `${point.x}:${point.z}`, node = axes.get(key) ?? { axes: 0, x: point.x, z: point.z };
      node.axes |= road.start.x === road.end.x ? 1 : 2;
      axes.set(key, node);
    }
  }
  return [...axes.values()].filter(node => node.axes === 3);
};

/**
 * The `isFree` test of `createRoadVergePlacements`: off water and barren ground, outside plots, fields and decoration
 * supports, and outside the two-lane cart clearance (`TWO_LANE_CART_HALF_WIDTH`) of every other road,
 * shifted out by bridge decks and the flared shore roads at their ends.
 * Band C herbs also keep out of crossing pockets. Presentation only: nothing here blocks traffic.
 */
export const createRoadVergeFreeTest = ({ blocked, isBare, roads }: RoadVergeObstacles) => {
  const traffic = roads.filter(road => !road.preview);
  const roadBuckets = createBuckets(traffic, segmentBounds,
    TWO_LANE_CART_HALF_WIDTH + ROAD_VERGE_MAX_WIDENING + MAX_REACH);
  const rectBuckets = createBuckets(blocked, rect => rect, MAX_REACH);
  const pockets = createBuckets(junctionNodes(traffic), node =>
    ({ maxX: node.x, maxZ: node.z, minX: node.x, minZ: node.z }), JUNCTION_POCKET);
  const isFree: RoadVergeFreeTest = (x, z, band, radius) => {
    const key = bucketKey(x, z);
    for (const road of roadBuckets.get(key) ?? [])
      if (roadClearanceGap(x, z, road) - radius < -1e-9) return false;
    for (const rect of rectBuckets.get(key) ?? [])
      if (x > rect.minX - radius && x < rect.maxX + radius && z > rect.minZ - radius && z < rect.maxZ + radius)
        return false;
    if (band === "C") for (const node of pockets.get(key) ?? [])
      if (Math.hypot(x - node.x, z - node.z) < JUNCTION_POCKET) return false;
    return !isBare(x, z);
  };
  return isFree;
};
