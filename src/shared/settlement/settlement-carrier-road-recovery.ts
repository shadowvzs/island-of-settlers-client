import { isBuildingCourtyardPointWalkable } from "../../render-common/buildings/building-courtyard";
import { stockStyleFor } from "../../render-common/buildings/building-stock-layout";
import { DMath } from "../math/deterministic-math";
import { bridgeDeckAnchorsAt } from "./bridge-deck-navigation";
import { nearestRoadEndpoints } from "./road-endpoints";
import type { RoadTier } from "./road-types";
import { ROAD_TIER_WIDTH } from "./road-types";
import { distanceToSegment } from "./settlement-geometry";
import { buildingNation } from "./settlement-nation";
import { findGroundPath, isGroundSegmentClear } from "./settlement-navigation";
import { navigationRevisionKey } from "./settlement-revision-key";
import { createTransientMap } from "./settlement-transient-state";
import type { SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

const ENTRY_RANGE = .85;
const withinCourt = (building: SettlementBuilding, point: SettlementPoint, margin = 1) =>
  Math.abs(point.x - building.x) <= building.width / 2 + margin &&
  Math.abs(point.z - building.z) <= building.depth / 2 + margin;
const actorCourts = (context: SettlementContext, actor: SettlementActor) => {
  const ids = new Set([actor.home, actor.building, actor.delivery?.source,
    actor.delivery?.destination, actor.stockBuilding]);
  return context.buildings.filter(building => ids.has(building.uid));
};

/** How far a carrier may step off a stand that a grown stock pile now covers. */
const PILE_STAND_EXIT_RADIUS = .4;
/**
 * A pile that grew under a standing carrier (a later delivery to the same bay) must not strand it:
 * the cells around its own stand count as walkable, so the search reaches the open courtyard.
 */
const standExit = (
  building: SettlementBuilding, actor: SettlementActor, walkable: (point: SettlementPoint) => boolean
) => {
  const stand = { x: actor.x, z: actor.z };
  return (point: SettlementPoint) => walkable(point) || (withinCourt(building, point, 0) &&
    DMath.hypot(point.x - stand.x, point.z - stand.z) <= PILE_STAND_EXIT_RADIUS);
};

/** A short, physically checked join followed by committed roads; never search terrain to a remote flag. */
export const carrierRoadRecoveryPath = (
  context: SettlementContext, actor: SettlementActor, target: SettlementPoint
): { court?: number; path: SettlementPoint[] } | null => {
  const roads = context.options.roads;
  const segments = roads.segments?.() ?? [];
  const nodes = nearestRoadEndpoints(segments, () => [], actor, 16)
    .filter(node => DMath.hypot(actor.x - node.x, actor.z - node.z) <= ENTRY_RANGE);
  // Mid-span on a long angled deck, the nearer shore anchor is the join.
  for (const node of [...nodes, ...bridgeDeckAnchorsAt(context, actor)]) {
    if (!isGroundSegmentClear(context, actor, node)) continue;
    const route = roads.route(node, target);
    if (route) return { path: [node, ...route.points] };
  }
  // A displaced saved unit can still be in its own hall. Only that local court may bridge to its flag.
  for (const building of actorCourts(context, actor)) {
    if (!withinCourt(building, actor)) continue;
    const route = roads.route(building.access, target);
    if (!route) continue;
    const walkable = (point: SettlementPoint) => withinCourt(building, point, 0) &&
      (context.options.canWorkerEnterPlot?.(building, point) ??
        isBuildingCourtyardPointWalkable(building.typeId, building.x, building.z, building.rotation,
          point, building.output, building.input, stockStyleFor(buildingNation(context, building), building)));
    const allow = walkable(actor) ? walkable : standExit(building, actor, walkable);
    const local = findGroundPath(context, actor, building.access,
      point => !withinCourt(building, point), allow, .125, 2048);
    if (local) return { court: building.uid, path: [...local, ...route.points] };
  }
  return null;
};

interface CheckedPath { path: SettlementPoint[]; revision: string; invalid: boolean }
const checkedPaths = createTransientMap<WeakMap<SettlementActor, CheckedPath>>();
type RoadSection = { start: SettlementPoint; end: SettlementPoint; tier?: RoadTier };
const roadBuckets = createTransientMap<{ revision: number; buckets: Map<string, RoadSection[]> }>();
/** Segments are fetched (copied) only when the road revision moved. */
const nearbyRoads = (context: SettlementContext) => {
  const revision = context.options.roads.revision ?? -1, previous = roadBuckets.get(context);
  if (previous?.revision === revision) return previous.buckets;
  const buckets = new Map<string, RoadSection[]>();
  for (const segment of context.options.roads.segments?.() ?? []) {
    const margin = ROAD_TIER_WIDTH[segment.tier ?? "dirt"] / 2 + .2;
    for (let x = Math.floor(Math.min(segment.start.x, segment.end.x) - margin);
      x <= Math.floor(Math.max(segment.start.x, segment.end.x) + margin); x++)
      for (let z = Math.floor(Math.min(segment.start.z, segment.end.z) - margin);
        z <= Math.floor(Math.max(segment.start.z, segment.end.z) + margin); z++) {
        const key = `${x}/${z}`, bucket = buckets.get(key);
        if (bucket) bucket.push(segment); else buckets.set(key, [segment]);
      }
  }
  roadBuckets.set(context, { buckets, revision });
  return buckets;
};

/**
 * Check loaded/pre-fix pickup paths once per path/revision, including already-running terrain repairs.
 * The memo is read first: its revision key includes the road revision, so a remembered answer was
 * computed over the same (non-empty) roads.
 */
export const carrierPickupLeavesRoads = (context: SettlementContext, actor: SettlementActor) => {
  if (actor.phase !== "pickup" || !actor.visible || !actor.path.length) return false;
  let checked = checkedPaths.get(context);
  if (!checked) { checked = new WeakMap(); checkedPaths.set(context, checked); }
  const revision = navigationRevisionKey(context), previous = checked.get(actor);
  if (previous?.path === actor.path && previous.revision === revision) return previous.invalid;
  // Every segment fills at least one bucket, so no bucket means no road.
  const buckets = nearbyRoads(context);
  if (!buckets.size) return false;
  const courts = actorCourts(context, actor);
  const allowed = (point: SettlementPoint) => courts.some(building => withinCourt(building, point)) ||
    (buckets.get(`${Math.floor(point.x)}/${Math.floor(point.z)}`) ?? []).some(segment =>
      distanceToSegment(point, segment.start, segment.end) <=
      ROAD_TIER_WIDTH[segment.tier ?? "dirt"] / 2 + .2);
  let from: SettlementPoint = actor, invalid = false;
  for (const point of actor.path.slice(actor.pathIndex)) {
    const length = DMath.hypot(point.x - from.x, point.z - from.z);
    const samples = Math.max(1, Math.ceil(length / .5));
    for (let step = 1; step <= samples; step++) {
      if (!allowed({ x: from.x + (point.x - from.x) * step / samples,
        z: from.z + (point.z - from.z) * step / samples })) { invalid = true; break; }
    }
    if (invalid) break;
    from = point;
  }
  checked.set(actor, { path: actor.path, revision, invalid });
  return invalid;
};
