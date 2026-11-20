import { buildingRoadApproachSpeedAt, createBuildingRoadApproaches } from "./building-road-approaches";
import { roadRibbonMaxWidth, type RoadSegment } from "./road-types";
import type { SettlementContext, SettlementPoint, SettlementRoads } from "./settlement-types";

/** Bucket edge in tiles of the approach index. */
const APPROACH_BUCKET = 1;
/** Bucket key stride; far larger than any island's bucket count along x. */
const APPROACH_STRIDE = 65_536;
/** The ribbon test's own tolerance plus a rounding margin, so no covering lane misses its bucket. */
const APPROACH_REACH_MARGIN = 0.01 + 1e-6;

interface ApproachCache {
  buckets: Map<number, RoadSegment[]>;
  buildingCount: number;
  revision: number | undefined;
}

const caches = new WeakMap<SettlementRoads, ApproachCache>();

const bucketOf = (value: number) => Math.floor(value / APPROACH_BUCKET);

/**
 * Each paved approach goes into every bucket its ribbon can reach. A lane that covers a point is
 * within its widest half ribbon (plus tolerance) of it, so it is in the point's own bucket; the speed
 * is the fastest covering lane, which the bucket subset therefore answers exactly.
 */
const indexApproaches = (approaches: readonly RoadSegment[]) => {
  const buckets = new Map<number, RoadSegment[]>();
  for (const segment of approaches) {
    const reach = roadRibbonMaxWidth(segment) / 2 + APPROACH_REACH_MARGIN;
    const { end, start } = segment;
    const toX = bucketOf(Math.max(start.x, end.x) + reach), toZ = bucketOf(Math.max(start.z, end.z) + reach);
    for (let z = bucketOf(Math.min(start.z, end.z) - reach); z <= toZ; z++)
      for (let x = bucketOf(Math.min(start.x, end.x) - reach); x <= toX; x++) {
        const key = z * APPROACH_STRIDE + x, list = buckets.get(key);
        if (list) list.push(segment);
        else buckets.set(key, [segment]);
      }
  }
  return buckets;
};

const NO_APPROACHES: readonly RoadSegment[] = [];

/** Called only for roads with `segments`. */
const approachCache = (context: SettlementContext, roads: SettlementRoads) => {
  const cached = caches.get(roads);
  if (cached && roads.revision !== undefined && cached.revision === roads.revision &&
    cached.buildingCount === context.buildings.length) return cached;
  const graphSegments = roads.segments!().map(segment => ({ ...segment, tier: segment.tier ?? "dirt" }));
  // Dirt lanes cannot increase movement speed; omit them from the per-actor search.
  const approaches = createBuildingRoadApproaches(graphSegments, context.buildings)
    .slice(graphSegments.length).filter(segment => segment.tier !== "dirt");
  const next = { buckets: indexApproaches(approaches), buildingCount: context.buildings.length,
    revision: roads.revision };
  caches.set(roads, next);
  return next;
};

/** The authored door lane is presentation geometry, never a traversable public graph edge. */
export const settlementRoadSpeedAt = (context: SettlementContext, point: SettlementPoint) => {
  const roads = context.options.roads;
  const graphSpeed = roads.speedAt?.(point) ?? 1;
  if (!roads.segments || graphSpeed >= 1.5) return graphSpeed;
  const { buckets } = approachCache(context, roads);
  const nearby = buckets.get(bucketOf(point.z) * APPROACH_STRIDE + bucketOf(point.x)) ?? NO_APPROACHES;
  return Math.max(graphSpeed, buildingRoadApproachSpeedAt(point, nearby));
};
