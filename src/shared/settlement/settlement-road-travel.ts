import { DMath } from "../math/deterministic-math";
import { bridgeLatticeSpan } from "./bridge-lattice";
import { compactRoadPoints, createRoadBend } from "./road-curves";
import { ROAD_TIER_WIDTH, type RoadTier } from "./road-types";
import { withBuildingNavigationSearch } from "./settlement-building-navigation";
import { isOwnStockCourtyard, ownDoorLaneProbe } from "./settlement-entrance";
import { isGroundSegmentClear, isNavigationClear } from "./settlement-navigation";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

export const ROAD_TRAVEL_LANE = 0.19;
/** Together with the opposite foot lane, retain the existing .46-tile horse clearance. */
export const MOUNT_TRAVEL_LANE = .31;
const prepared = new WeakSet<SettlementPoint[]>();
const roadPhases = new Set(["assigned", "retire", "pickup", "deliver", "home", "exitLoaded", "navalToHarbour", "settlerRelocate"]);
const caches = new WeakMap<SettlementContext, { revision: number; edges: Map<string, RoadTier> }>();
const key = (a: SettlementPoint, b: SettlementPoint) =>
  [`${a.x}:${a.z}`, `${b.x}:${b.z}`].sort().join("/");
const roadEdges = (context: SettlementContext) => {
  const roads = context.options.roads;
  if (!roads.segments) return null;
  const revision = roads.revision ?? -1;
  const previous = caches.get(context);
  if (previous?.revision === revision) return previous.edges;
  const edges = new Map(roads.segments().map((segment) =>
    [key(segment.start, segment.end), segment.tier ?? "dirt"] as const));
  caches.set(context, { revision, edges });
  return edges;
};
/**
 * The tier of a straight leg made only of public road edges ("dirt" if any is dirt), else null.
 * Ordinary roads step one half cell along an axis; an angled bridge deck steps one primitive lattice
 * edge, so the leg is walked in the span's own lattice steps.
 */
const roadLineTier = (edges: Map<string, RoadTier>, a: SettlementPoint, b: SettlementPoint): RoadTier | null => {
  const span = bridgeLatticeSpan(a, b);
  if (!span) return null;
  const dx = b.x - a.x, dz = b.z - a.z;
  let previous = a, tier: RoadTier = "stone";
  for (let index = 1; index <= span.edges; index++) {
    const next = { x: a.x + (dx * index) / span.edges, z: a.z + (dz * index) / span.edges };
    const edge = edges.get(key(previous, next));
    if (!edge) return null;
    if (edge === "dirt") tier = "dirt";
    previous = next;
  }
  return tier;
};

/** Door approaches and courtyard paths do not inherit the passing offset of a public road. */
export const isPublicRoadLeg = (context: SettlementContext, from: SettlementPoint, to: SettlementPoint) => {
  const edges = roadEdges(context);
  return !!edges && roadLineTier(edges, from, to) !== null;
};

export const isPreparedRoadTravel = (actor: SettlementActor) =>
  roadPhases.has(actor.phase) && actor.job !== "Mount" && prepared.has(actor.path);

/**
 * A saved road journey already under way was prepared (rounded and lane-offset) at its first step;
 * the loaded copy is a new array, so mark it again rather than offsetting its lane a second time.
 */
export const restorePreparedRoadTravel = (context: SettlementContext, saved?: readonly number[]) => {
  const ids = saved && new Set(saved);
  for (const actor of context.actors)
    if ((ids ? ids.has(actor.uid) : actor.pathIndex > 0) && roadPhases.has(actor.phase) && actor.job !== "Mount")
      prepared.add(actor.path);
};

/** Round only validated public road legs, retaining exact stock contacts and doorway positions. */
export const prepareRoadTravel = (context: SettlementContext, actor: SettlementActor) => {
  if (prepared.has(actor.path) || !roadPhases.has(actor.phase) || actor.job === "Mount") return;
  prepareRoadPath(context, actor, ROAD_TRAVEL_LANE);
};

/**
 * Rounds a fresh public-road path, offset by `lane` to the right of travel; legs entirely on stone
 * use `stoneLane` and bend like the wider stone ribbon (carts keep right only on 1.2 stone roads).
 */
export const prepareRoadPath = (context: SettlementContext, actor: SettlementActor, lane: number,
  stoneLane = lane) => {
  const edges = roadEdges(context);
  if (!edges || actor.pathIndex !== 0) return;
  // A10b: nothing changes while the path is rounded, so building volumes are prepared once.
  withBuildingNavigationSearch(context, () => roundRoadPath(context, actor, edges, lane, stoneLane));
};
const roundRoadPath = (context: SettlementContext, actor: SettlementActor, edges: Map<string, RoadTier>,
  lane: number, stoneLane: number) => {
  const points = compactRoadPoints([actor, ...actor.path], 3);
  const samples: { point: SettlementPoint; tangent: SettlementPoint; road: boolean; lane: number }[] = [];
  const append = (point: SettlementPoint, tangent: SettlementPoint, road: boolean, sampleLane = lane) => {
    if (
      samples.length &&
      DMath.hypot(point.x - samples.at(-1)!.point.x, point.z - samples.at(-1)!.point.z) < 1e-7
    )
      return;
    samples.push({ lane: sampleLane, point, tangent, road });
  };
  let previous = points[0]!;
  for (let index = 1; index < points.length; index++) {
    const point = points[index]!,
      next = points[index + 1];
    const tier = roadLineTier(edges, points[index - 1]!, point), road = tier !== null;
    const nextTier = road && next ? roadLineTier(edges, point, next) : null;
    const bendTier = tier !== null && tier !== "dirt" && nextTier !== null && nextTier !== "dirt" ? "stone" : "dirt";
    const bend = nextTier ? createRoadBend(points[index - 1]!, point, next!, ROAD_TIER_WIDTH[bendTier]) : null;
    const legLane = tier !== null && tier !== "dirt" ? stoneLane : lane;
    const end = bend?.start ?? point;
    const length = DMath.hypot(end.x - previous.x, end.z - previous.z);
    const tangent = {
      x: (end.x - previous.x) / (length || 1),
      z: (end.z - previous.z) / (length || 1)
    };
    const steps = road ? Math.max(1, Math.ceil(length / 0.35)) : 1;
    for (let step = 1; step <= steps; step++)
      append(
        {
          x: previous.x + ((end.x - previous.x) * step) / steps,
          z: previous.z + ((end.z - previous.z) * step) / steps
        },
        tangent,
        road,
        legLane
      );
    if (!bend) {
      previous = point;
      continue;
    }
    for (let step = 1; step <= 8; step++) {
      const angle = bend.startAngle + (bend.sweep * step) / 8;
      const sign = Math.sign(bend.sweep);
      append(
        {
          x: bend.centre.x + DMath.cos(angle) * bend.radius,
          z: bend.centre.z + DMath.sin(angle) * bend.radius
        },
        { x: -DMath.sin(angle) * sign, z: DMath.cos(angle) * sign },
        true,
        bendTier === "stone" ? stoneLane : lane
      );
    }
    previous = bend.end;
  }
  let last: SettlementPoint = actor;
  // The actor does not change until the new path is assigned, so its own lanes are resolved once.
  const isOwnLane = ownDoorLaneProbe(context, actor);
  const allowsFoundation = (position: SettlementPoint) =>
    isOwnLane(position) || isOwnStockCourtyard(context, actor, position);
  const path = samples.map((sample, index) => {
    const final = index === samples.length - 1;
    const distanceFromStart = DMath.hypot(sample.point.x - actor.x, sample.point.z - actor.z);
    const destination = points.at(-1)!;
    const distanceToEnd = DMath.hypot(
      sample.point.x - destination.x,
      sample.point.z - destination.z
    );
    const offset =
      sample.road && !final
        ? sample.lane * Math.min(1, distanceFromStart / 0.6, distanceToEnd / 0.6)
        : 0;
    let point = {
      x: sample.point.x - sample.tangent.z * offset,
      z: sample.point.z + sample.tangent.x * offset
    };
    const offsetClear = isNavigationClear(context, point) &&
      isGroundSegmentClear(context, last, point, undefined, allowsFoundation);
    if (!offsetClear) point = sample.point;
    // Never introduce a curve through an obstacle: the original route remains the safe fallback.
    // A10b: a clear offset point already passed this same (pure) segment test.
    if (!offsetClear && !isGroundSegmentClear(context, last, point, undefined, allowsFoundation)) return null;
    last = point;
    return point;
  });
  if (path.some((point) => !point)) {
    prepared.add(actor.path);
    return;
  }
  actor.path = path as SettlementPoint[];
  prepared.add(actor.path);
};
