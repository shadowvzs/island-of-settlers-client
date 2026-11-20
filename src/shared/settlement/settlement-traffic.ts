import { WORKER_COLLISION_SCALE } from "../../render-common/workers/worker-dimensions";
import { DMath } from "../math/deterministic-math";
import { profileNavigationStage } from "./navigation-profile";
import { getBuilding } from "./settlement-building-index";
import { withBuildingNavigationSearch } from "./settlement-building-navigation";
import { isInOwnDoorPassage, isNearDoorLane, isOwnDoorLane, isOwnStockCourtyard } from "./settlement-entrance";
import { distanceToSegment } from "./settlement-geometry";
import { isOwnHeadquarters } from "./settlement-home";
import { nearbyTrafficActorsWhere } from "./settlement-person-index";
import { isPreparedRoadTravel, isPublicRoadLeg, MOUNT_TRAVEL_LANE, ROAD_TRAVEL_LANE } from "./settlement-road-travel";
import { trafficWork } from "./settlement-traffic-counters";
import {
  collectTrafficBodies, isSegmentClearInSearch, isTrafficSegmentClearWith, type TrafficBody, trafficBodyReach
} from "./settlement-traffic-segment";
import type { SettlementActor, SettlementContext, SettlementPoint, TrafficQueueKind } from "./settlement-types";

/** Two riders side by side pass about this far apart; nose to tail they keep a horse's length. */
const RIDERS_ABREAST = 1.1;
const RIDERS_IN_FILE = 2.1;
/** Minimum distance between a physical rider and a foot body. Combat uses the same bound. */
export const RIDER_FOOT_SEPARATION = 1.25;
/** How much the offset lies along the rider's heading (1: ahead or behind) rather than beside it (0). */
const alongHeading = (rider: SettlementActor, offset: SettlementPoint) => {
  const distance = DMath.hypot(offset.x, offset.z) || 1;
  return Math.abs(offset.x * DMath.sin(rider.yaw) + offset.z * DMath.cos(rider.yaw)) / distance;
};
/** Clearance of an elliptical horse body (long along its heading) in a direction `along` its heading. */
const ellipseClearance = (along: number) => RIDERS_ABREAST * RIDERS_IN_FILE /
  DMath.hypot(RIDERS_ABREAST * along, RIDERS_IN_FILE * Math.sqrt(Math.max(0, 1 - along * along)));
/** A horse is long and narrow: two riders may pass abreast (owner decision 2026-10-13). */
const riderSeparation = (a: SettlementActor, b: SettlementActor, offset: SettlementPoint) =>
  ellipseClearance(Math.max(alongHeading(a, offset), alongHeading(b, offset)));

const isCivilian = (actor: SettlementActor) => actor.job !== "Soldier" && actor.job !== "Mount";
/**
 * Soldiers and civilian workers pass through each other (owner decision 2026-10-13): marching
 * troops never block roads and workers never block troops. The renderer nudges the figures apart.
 */
export const isMilitaryPassThrough = (a: SettlementActor, b: SettlementActor) =>
  (a.job === "Soldier" && isCivilian(b)) || (b.job === "Soldier" && isCivilian(a));

const headquartersFor = (context: SettlementContext, actor: SettlementActor) => {
  const home = getBuilding(context, actor.home);
  if (home && isOwnHeadquarters(home)) return home;
  const destination = getBuilding(context, actor.building);
  return destination && isOwnHeadquarters(destination) ? destination : undefined;
};

/** Friendly foot traffic may overlap in the HQ entrance lane; carts and horses retain clearance. */
const STORAGE_QUEUE_PHASES = new Set(["home", "retire", "pickup", "deliver", "enterHome", "enterRetire",
  "enterPickup", "enterDelivery", "exitLoaded", "exitDelivery"]);
const storageQueuePhase = (actor: SettlementActor) => STORAGE_QUEUE_PHASES.has(actor.phase);

/** FIFO storage arrivals may pass later queue members; a dense shoulder must not freeze the head. */
const earlierStorageArrival = (a: SettlementActor, b: SettlementActor) =>
  storageQueuePhase(a) && storageQueuePhase(b) &&
  a.storageArrivalBuilding !== undefined && a.storageArrivalBuilding === b.storageArrivalBuilding &&
  a.storageArrivalOrder !== undefined && b.storageArrivalOrder !== undefined &&
  a.storageArrivalOrder < b.storageArrivalOrder;

const CATAPULT_PORTER_PHASES = new Set(["catapultResupply", "catapultEvacuate"]);
const isFriendlyFootTraffic = (context: SettlementContext, actor: SettlementActor) =>
  !actor.mounted && !actor.handcart &&
  (actor.job === "Carrier" || (actor.job === "Soldier" && context.military?.factionOf?.(actor.uid) === 0));
export const isTrafficPassThrough = (context: SettlementContext, a: SettlementActor, b: SettlementActor) => {
  if (CATAPULT_PORTER_PHASES.has(a.phase) || CATAPULT_PORTER_PHASES.has(b.phase)) return true;
  if (isMilitaryPassThrough(a, b)) return true;
  if (earlierStorageArrival(a, b)) return true;
  if (!isFriendlyFootTraffic(context, a) || !isFriendlyFootTraffic(context, b)) return false;
  const hq = headquartersFor(context, a) ?? headquartersFor(context, b);
  return !!hq && hq.construction === 1 && isNearDoorLane(hq, a, 2.5) && isNearDoorLane(hq, b, 2.5);
};

/** Shoulder clearance of two fighting bodies, and of every other pair of people on foot. */
const FIELD_BODY_SEPARATION = .38;
const FOOT_BODY_SEPARATION = .22 * WORKER_COLLISION_SCALE;
/** Largest `actorSeparation` of two people on foot without a horse, handcart or mount. */
export const FOOT_SEPARATION_BOUND = Math.max(FIELD_BODY_SEPARATION, FOOT_BODY_SEPARATION);
/** `offset`: where `b` stands relative to `a` (default: now); riders' clearance depends on it. */
export const actorSeparation = (a: SettlementActor, b: SettlementActor,
  offset: SettlementPoint = { x: b.x - a.x, z: b.z - a.z }) => {
  if (a.mounted && b.mounted) return riderSeparation(a, b, offset);
  if (a.mounted || b.mounted) return RIDER_FOOT_SEPARATION;
  if (a.job === "Mount" || b.job === "Mount") return .46;
  // Fighting bodies need full shoulder clearance; civilian road spacing keeps the owner's scale.
  if (a.phase === "militaryField" && b.phase === "militaryField") return FIELD_BODY_SEPARATION;
  return FOOT_BODY_SEPARATION;
};

/** Recover initial shoulder compression only by increasing separation; never enter another unit. */
export const isSeparatingTrafficStep = (actor:SettlementActor, other:SettlementActor, point:SettlementPoint) => {
  const separation=actorSeparation(actor,other);
  const start=DMath.hypot(actor.x-other.x,actor.z-other.z);
  return start<separation && DMath.hypot(point.x-other.x,point.z-other.z)>start+1e-8;
};

export const isTrafficSegmentClear = (context: SettlementContext, actor: SettlementActor,
  destination: SettlementPoint, checkPeople = false) => profileNavigationStage("traffic.segmentClear",
  () => isTrafficSegmentClearWith(context, actor, destination, checkPeople));
const STOCK_WALK_PHASES = new Set(["deliveryStockWalk", "pickupStockWalk", "inputApproach", "outputWalk"]);
const horseLaneChecks = new WeakMap<SettlementActor, {
  context: SettlementContext; path: SettlementPoint[]; index: number; phase: string;
  point: SettlementPoint; origin: SettlementPoint; target: SettlementPoint; revision: string;
}>();
/** A validated static leg stays clear while the horse follows it and navigation has not changed. */
const horsePassingTarget = (context: SettlementContext, actor: SettlementActor,
  point: SettlementPoint, lane: SettlementPoint) => {
  const { roads, world } = context.options;
  const revision = `${world.buildRevision ?? 0}:${world.terrainRevision ?? 0}:` +
    `${context.navigationRevision ?? 0}:${roads.revision ?? 0}`;
  const cached = horseLaneChecks.get(actor);
  if (cached && cached.context === context && cached.path === actor.path && cached.index === actor.pathIndex &&
    cached.phase === actor.phase && cached.point === point && cached.revision === revision &&
    distanceToSegment(actor, cached.origin, cached.target) < 1e-7) return cached.target;
  if (!isTrafficSegmentClear(context, actor, lane)) return point;
  horseLaneChecks.set(actor, { context, path: actor.path, index: actor.pathIndex, phase: actor.phase,
    point, origin: { x: actor.x, z: actor.z }, target: lane, revision });
  return lane;
};
export const trafficTarget = (context: SettlementContext, actor: SettlementActor, point: SettlementPoint) => {
  if (actor.queueTarget) return actor.queueTarget;
  if (isPreparedRoadTravel(actor)) return point;
  // A finely routed stock yard is not a public two-lane road: offsets would cut around its boxes.
  const court=getBuilding(context, actor.stockBuilding);
  const inCourt=(value:SettlementPoint)=>court && Math.abs(value.x-court.x)<=court.width/2+.15 &&
    Math.abs(value.z-court.z)<=court.depth/2+.15;
  if (inCourt(actor) || inCourt(point) || STOCK_WALK_PHASES.has(actor.phase)) return point;
  if (!["Carrier", "Mount"].includes(actor.job) || actor.handcart ||
    actor.pathIndex === 0 ||
    actor.pathIndex === actor.path.length - 1) return point;
  const previous = actor.path[actor.pathIndex - 1]!;
  if (actor.job === "Mount" && !isPublicRoadLeg(context, previous, point)) return point;
  const dx = point.x - previous.x, dz = point.z - previous.z;
  const length = DMath.hypot(dx, dz);
  if (!length) return point;
  const offset = actor.job === "Mount" ? MOUNT_TRAVEL_LANE : ROAD_TRAVEL_LANE;
  const lane = { x: point.x - dz / length * offset, z: point.z + dx / length * offset };
  if (actor.job === "Mount") return horsePassingTarget(context, actor, point, lane);
  // A diagonal lane transition at a bend must not cut across a neighboring foundation.
  return isTrafficSegmentClear(context, actor, lane) ? lane : point;
};
/** Shoulder spots other people are already heading for, with the clearance `actor` keeps from each. */
const takenQueueSpots = (context: SettlementContext, actor: SettlementActor) => {
  const spots: { limit: number; target: SettlementPoint }[] = [];
  for (const other of context.actors) if (other !== actor && other.queueTarget)
    spots.push({ limit: actorSeparation(actor, other) + .1, target: other.queueTarget });
  return spots;
};
const isWithin = (point: SettlementPoint, target: SettlementPoint, limit: number) =>
  DMath.hypot(point.x - target.x, point.z - target.z) < limit;
const isSpotTaken = (spots: ReturnType<typeof takenQueueSpots>, point: SettlementPoint) =>
  spots.some(({ limit, target }) => isWithin(point, target, limit));
export const isQueueSpotTaken = (context: SettlementContext, actor: SettlementActor, point: SettlementPoint) =>
  context.actors.some(other => other !== actor && other.queueTarget &&
    isWithin(point, other.queueTarget, actorSeparation(actor, other) + .1));
const YIELD_DISTANCES = [0.24, 0.34, 0.4, 0.65, 0.85];
const YIELD_FORWARD = [0.25, 0, -0.25];
/** The longest shoulder step, so one people read around the actor covers every candidate's query. */
const YIELD_REACH = Math.max(...YIELD_DISTANCES.flatMap(distance =>
  YIELD_FORWARD.map(forward => DMath.hypot(distance, forward))));
/**
 * Nothing moves while the 30 shoulders are tried, so the queue spots and the people are read once
 * (A10b); each candidate's test still sees exactly the people its own query would return.
 */
export const chooseYieldTarget = (
  context: SettlementContext, actor: SettlementActor, blocker: SettlementActor, target: SettlementPoint, force = false,
  allowed: (point:SettlementPoint) => boolean = () => true
) => {
  trafficWork.yieldCalls++;
  if (!force && actor.uid < blocker.uid) return null;
  const dx = target.x - actor.x, dz = target.z - actor.z;
  const length = DMath.hypot(dx, dz);
  if (!length) return null;
  const forwardX = dx / length, forwardZ = dz / length;
  return withBuildingNavigationSearch(context, () => firstClearShoulder(context, actor, forwardX, forwardZ, allowed));
};
const firstClearShoulder = (context: SettlementContext, actor: SettlementActor, forwardX: number,
  forwardZ: number, allowed: (point: SettlementPoint) => boolean) => {
  let spots: ReturnType<typeof takenQueueSpots> | undefined;
  let bodies: TrafficBody[] | undefined;
  for (const distance of YIELD_DISTANCES) {
    for (const side of [1, -1]) {
      for (const forward of YIELD_FORWARD) {
        const point = { x: actor.x - forwardZ * distance * side + forwardX * forward,
          z: actor.z + forwardX * distance * side + forwardZ * forward };
        if (!allowed(point)) continue;
        spots ??= takenQueueSpots(context, actor);
        if (isSpotTaken(spots, point)) continue;
        bodies ??= collectTrafficBodies(context, actor, actor, trafficBodyReach(actor, YIELD_REACH));
        if (profileNavigationStage("traffic.segmentClear",
          () => isSegmentClearInSearch(context, actor, point, true, bodies))) return point;
      }
    }
  }
  return null;
};

/** Predict closest approach before shoulder contact, retaining existing unit priority at crossings. */
export const anticipatedTrafficBlocker = (
  context: SettlementContext, actor: SettlementActor, target: SettlementPoint, speed: number
) => {
  if (actor.queueTarget || actor.phase.startsWith("well") || isInOwnDoorPassage(context, actor) ||
    isOwnDoorLane(context, actor, actor) || isOwnStockCourtyard(context, actor, actor)) return null;
  const dx = target.x - actor.x, dz = target.z - actor.z, length = DMath.hypot(dx, dz);
  if (!length) return null;
  const vx = dx / length * speed, vz = dz / length * speed;
  // The loop skipped these people by pure tests before any side effect: drop them before the order sort.
  const near = nearbyTrafficActorsWhere(context, actor, 1.6, other => other !== actor && other.visible &&
    (other.x - actor.x) * (other.x - actor.x) + (other.z - actor.z) * (other.z - actor.z) <= 1.6 * 1.6 &&
    !isTrafficPassThrough(context, actor, other));
  for (const other of near) {
    const rx = other.x - actor.x, rz = other.z - actor.z;
    const waypoint = other.path[other.pathIndex];
    // A horse's saved route stays on the road centreline; its actual movement uses the passing
    // offset. Predict that same target rather than a phantom turn back into oncoming traffic.
    const destination = other.queueTarget ?? (other.job === "Mount" && waypoint
      ? trafficTarget(context, other, waypoint) : waypoint);
    const moving = destination && (other.queueTarget || ["walk", "carry"].includes(other.action));
    if (moving && actor.uid < other.uid) continue;
    const otherLength = moving ? DMath.hypot(destination.x - other.x, destination.z - other.z) : 0;
    const otherSpeed = other.locomotionSpeed ?? (other.job === "Carrier" ? 1.2 : .9);
    const rvx = (otherLength ? (destination!.x - other.x) / otherLength * otherSpeed : 0) - vx;
    const rvz = (otherLength ? (destination!.z - other.z) / otherLength * otherSpeed : 0) - vz;
    const velocitySquared = rvx * rvx + rvz * rvz;
    if (velocitySquared < 1e-7) continue;
    const time = -(rx * rvx + rz * rvz) / velocitySquared;
    if (time <= 0 || time > .85) continue;
    const closest = { x: rx + rvx * time, z: rz + rvz * time };
    if (DMath.hypot(closest.x, closest.z) < actorSeparation(actor, other, closest) + .03) return other;
  }
  return null;
};

/** Sets a shoulder target; the kind decides whether arrival pauses and who drives the walk. */
export const setQueueTarget = (actor: SettlementActor, point: SettlementPoint, kind?: TrafficQueueKind) => {
  actor.queueTarget = point; actor.queueWait = 0; actor.queueKind = kind;
};
const SHOVEABLE_ARRIVED_PHASES = new Set(["deliver", "home", "pickup", "retire", "returnWork"]);
const SHOVEABLE_BLOCKED_PHASES = new Set([
  "carrierLoadedBlocked", "carrierDeliveryBlocked", "carrierPickupBlocked", "returnBlockedCarrier"
]);
/** Road transport units: settler carriers and the commander's mounts. */
const ROAD_CARRIER_JOBS = new Set(["Carrier", "Mount"]);
const isShoveableCarrier = (actor: SettlementActor) =>
  ROAD_CARRIER_JOBS.has(actor.job) && (SHOVEABLE_BLOCKED_PHASES.has(actor.phase) ||
    (SHOVEABLE_ARRIVED_PHASES.has(actor.phase) && actor.pathIndex >= actor.path.length) ||
    (actor.phase === "idle" && !actor.delivery));
/** Military rule (battle AI): a soldier standing idle in the field, never mid-blow, steps aside for troops. */
const isIdleFieldSoldier = (actor: SettlementActor) =>
  actor.phase === "militaryField" && actor.action === "idle" && actor.pathIndex >= actor.path.length;
/**
 * A genuinely unburdened idle worker can clear a road shoulder. Anyone with a pending delivery,
 * cargo, tool, work contact or route is left to the navigation watchdog/cancel path instead.
 */
const isUnburdenedIdleWorker = (actor: SettlementActor) =>
  actor.visible && actor.action === "idle" && actor.pathIndex >= actor.path.length &&
  !actor.delivery && !actor.ware && !actor.tool && !actor.target && !actor.wareTransfer &&
  !actor.stockContact && !actor.fieldWork && !actor.sowingBatch && !actor.handcart &&
  actor.navalOrder === undefined;
/**
 * Carriers, idle field soldiers and truly unburdened idle workers may be pushed aside. A carrying
 * worker keeps the owner rule: the task owns the spot until it moves or cancels.
 */
export const isShoveableIdler = (actor: SettlementActor) =>
  isShoveableCarrier(actor) || isIdleFieldSoldier(actor) || isUnburdenedIdleWorker(actor);
const roadDistance = (context: SettlementContext, point: SettlementPoint) => {
  let nearest = Infinity;
  for (const segment of context.options.roads.segments?.() ?? [])
    nearest = Math.min(nearest, distanceToSegment(point, segment.start, segment.end));
  return nearest;
};
const canBeShoved = (context: SettlementContext, blocker: SettlementActor) =>
  blocker.visible && !blocker.queueTarget && blocker.action === "idle" && !blocker.demolitionReturning &&
  isShoveableIdler(blocker) && !blocker.wareTransfer && !blocker.wellWork && !blocker.foresterSeedling &&
  !isInOwnDoorPassage(context, blocker) && !isOwnDoorLane(context, blocker, blocker) &&
  !isOwnStockCourtyard(context, blocker, blocker);
/** An idle traveller clears a public road for a passer; it never interrupts a tool contact, handoff or doorway. */
export const requestStationaryRoadYield = (context: SettlementContext, blocker: SettlementActor,
  passing: SettlementActor, target: SettlementPoint) => {
  if (!canBeShoved(context, blocker) || roadDistance(context, blocker) > .4) return false;
  const dx = target.x - passing.x, dz = target.z - passing.z, length = DMath.hypot(dx, dz);
  if (!length) return false;
  const shoulders = blocker.mounted ? [1.35, 1.65, 1.95] : [.65, .85, 1.05];
  for (const distance of shoulders) for (const side of [1, -1]) {
    const point = { x: blocker.x - dz / length * distance * side, z: blocker.z + dx / length * distance * side };
    if (roadDistance(context, point) < .5 || isQueueSpotTaken(context, blocker, point)) continue;
    if (!isTrafficSegmentClear(context, blocker, point, true)) continue;
    setQueueTarget(blocker, point, "stationary");
    return true;
  }
  return false;
};
/** Escape an already compressed crowd only along an edge that increases every overlapping separation. */
export const chooseCrowdEscapeTarget=(context:SettlementContext,actor:SettlementActor,
 allowed:(point:SettlementPoint)=>boolean=()=>true)=>{
 trafficWork.crowdEscapeCalls++;
 for(const distance of [.28,.4,.6])for(let direction=0;direction<16;direction++){
  const angle=direction*Math.PI/8;
  const point={x:actor.x+DMath.cos(angle)*distance,z:actor.z+DMath.sin(angle)*distance};
  if(allowed(point) && isTrafficSegmentClear(context,actor,point,true))return point;
 }
 return null;
};
