import { isBuildingCourtyardEscapeStep, isBuildingCourtyardPointWalkable } from "../../render-common/buildings/building-courtyard";
import { stockStyleFor } from "../../render-common/buildings/building-stock-layout";
import { WORKER_RADIUS } from "../../render-common/workers/worker-dimensions";
import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { renewActorIncarnation } from "./actor-incarnation";
import { entersClosedDeck } from "./bridge-deck-navigation";
import { holdBridgeWait } from "./bridge-wait";
import { civilianHeldInside } from "./military-civilian-safety";
import { getBuilding } from "./settlement-building-index";
import { cadenceTick, isCadenceSlot, QUARTER_SECOND_TICKS } from "./settlement-cadence";
import { isCorridorCellReserved, refreshCorridor, releaseCorridor } from "./settlement-corridor-reservations";
import { admitStorageArrival, canBeginStorageExit, isHoldingStorageTurn,ownsStorageArrival } from "./settlement-door-traffic";
import { doorstepSquatter, waitAtBlockedDoorstep } from "./settlement-doorstep-yield";
import { canLeaveDoor, isOwnDoorLane, isOwnStockCourtyard, passageBuilding } from "./settlement-entrance";
import { isFishingShoreSegmentClear, isFishingShoreStep } from "./settlement-fishing";
import { turnYawToward } from "./settlement-geometry";
import { ADVENTURE_BEACH } from "./settlement-landing-phases";
import { isOwnLevelerSitePoint } from "./settlement-leveler-access";
import {
  advanceMovementExecution, beginMovementExecution, completeMovementExecution,
  movementExecutionEligible, movementExecutionWake, movementExecutionWork, recoverMovementExecution
} from "./settlement-movement-executor";
import { actorGroundSpeed } from "./settlement-movement-speed";
import { buildingNation } from "./settlement-nation";
import {
  findGroundPath, isGroundSegmentClear, isMountedNavigationClear, isNavigationClear, isNavigationEscapeClear
} from "./settlement-navigation";
import { movementOutcome,recordMovementOutcome } from "./settlement-navigation-recovery";
import { findObstacleDetour } from "./settlement-obstacle-detours";
import { isMilitaryMover, passOccupiedWaypoint, skipPassedWaypoints } from "./settlement-occupied-waypoints";
import { actorEconomyOwnerOf, economyOwnerOf, PLAYER_FACTION } from "./settlement-ownership";
import { firstNearbyTrafficActorWhere, updatePersonTraffic } from "./settlement-person-index";
import { countOnDuty, takeIdleSettler } from "./settlement-population";
import { refreshRoadTravel } from "./settlement-road-rerouting";
import { settlementRoadSpeedAt } from "./settlement-road-speed";
import { prepareRoadTravel } from "./settlement-road-travel";
import {
  canEnterStockCourt, canUseStockYieldPoint, isQueuedCourtPeer, ownsStockCourt, stockEntryRival
} from "./settlement-stock-traffic";
import { prepareStorageDoorDeparture } from "./settlement-storage-door-lanes";
import { publicWalkPath } from "./settlement-terrain-routing";
import {
  actorSeparation, anticipatedTrafficBlocker, chooseCrowdEscapeTarget, chooseYieldTarget, isSeparatingTrafficStep,
isShoveableIdler,   isTrafficPassThrough, requestStationaryRoadYield, setQueueTarget, trafficTarget
} from "./settlement-traffic";
import { trafficWork } from "./settlement-traffic-counters";
import { clearTrafficBlocker, recordTrafficBlocker, requestTrafficCycleBackout } from "./settlement-traffic-deadlock";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";
import { faceWaitingDestination } from "./settlement-waiting-heading";
import {
  ensureWorkerMovementPlan, markWorkerMovement
} from "./settlement-worker-movement-plan";
import { isAnticipationSuppressed, spendProactiveSidestep, tickYieldBudget } from "./settlement-yield-budget";
import { startYieldPause, updateYieldPause } from "./settlement-yield-pause";

const defaultGroundPath = (
  context: SettlementContext, from: SettlementPoint, to: SettlementPoint, ownBuilding?: number
) => {
  if (context.options.findWorkerPath) return context.options.findWorkerPath(from, to);
  const courtyard = context.buildings.find(building => building.uid === ownBuilding);
  if (!courtyard) return findGroundPath(context,from,to);
  const stockStyle = stockStyleFor(buildingNation(context, courtyard), courtyard);
  const allow = (point:SettlementPoint) => {
    const worker = from as Partial<SettlementActor>;
    if (worker.job === "Leveler" && courtyard.construction < 1)
      return isOwnLevelerSitePoint(context, worker, point, courtyard);
    const within = point.x >= courtyard.x-courtyard.width/2 && point.x <= courtyard.x+courtyard.width/2 &&
      point.z >= courtyard.z-courtyard.depth/2 && point.z <= courtyard.z+courtyard.depth/2;
    if (!within) return false;
    return (context.options.canWorkerEnterPlot?.(courtyard,point) ??
        isBuildingCourtyardPointWalkable(courtyard.typeId,courtyard.x,courtyard.z,courtyard.rotation,point,
          courtyard.output,courtyard.input,stockStyle)) ||
      isBuildingCourtyardEscapeStep(courtyard.typeId, courtyard.x, courtyard.z, courtyard.rotation,
        from, point, courtyard.output, courtyard.input, stockStyle);
  };
  const nearby = (point:SettlementPoint) => Math.abs(point.x-courtyard.x)<=courtyard.width/2+1 &&
    Math.abs(point.z-courtyard.z)<=courtyard.depth/2+1;
  const fine = (start:SettlementPoint,end:SettlementPoint) => findGroundPath(context,start,end,undefined,allow,.125);
  // Keep the fine mesh local: long forest/HQ journeys must retain the normal land-routing budget.
  if (nearby(from) && nearby(to)) return fine(from,to);
  if (!nearby(from) && !nearby(to)) return findGroundPath(context,from,to);
  // A worker leaving or reaching its own yard walks straight; the road access is only a fallback.
  const direct = findGroundPath(context, from, to, undefined, allow);
  if (direct) return direct;
  const first = nearby(from) ? fine(from,courtyard.access) : findGroundPath(context,from,courtyard.access);
  const second = nearby(from) ? findGroundPath(context,courtyard.access,to) : fine(courtyard.access,to);
  return first && second ? [...first,...second] : null;
};
/** Normal land routing ends at the dry cell entry; only a proven dry Fisher beach leg follows it. */
export const groundPath = (context: SettlementContext, from: SettlementPoint, to: SettlementPoint,
  ownBuilding?: number): SettlementPoint[] | null => {
  const shore = to as NonNullable<import("./settlement-types").ResourceTarget["approach"]>;
  const actor = from as Partial<SettlementActor>;
  const bridge = (start: SettlementPoint, end: SettlementPoint) => {
    const count = Math.max(1, Math.ceil(DMath.hypot(end.x - start.x, end.z - start.z) / .1));
    return Array.from({ length: count }, (_, index) => ({ x: start.x + (end.x - start.x) * (index + 1) / count,
      z: start.z + (end.z - start.z) * (index + 1) / count }));
  };
  if (shore.shoreEntry && shore.waterY !== undefined) {
    const path = defaultGroundPath(context, from, shore.shoreEntry, ownBuilding);
    return path && isFishingShoreSegmentClear(context, shore.shoreEntry, shore, shore.waterY)
      ? [...path, ...bridge(shore.shoreEntry, shore)] : null;
  }
  const homeShore = actor.target?.approach;
  if (homeShore?.shoreEntry && homeShore.waterY !== undefined && isFishingShoreStep(context, actor, from)) {
    const entry = homeShore.shoreEntry;
    const path = defaultGroundPath(context, entry, to, ownBuilding);
    if (path && isFishingShoreSegmentClear(context, from, entry, homeShore.waterY))
      return [...bridge(from, entry), ...path];
    // Old saves and new obstacles can invalidate the original beach entry. Keep the caught fish
    // and walk around the obstruction to a nearby dry land entry instead of retrying one line forever.
    const allowsBeach = (point: SettlementPoint) => isFishingShoreStep(context, actor, point);
    for (const [dx, dz] of [[0, 0], [.5, 0], [-.5, 0], [0, -.5], [0, .5], [.75, 0], [-.75, 0]]) {
      const alternative = { x: entry.x + dx!, z: entry.z + dz! };
      if (!isNavigationClear(context, alternative)) continue;
      const beach = findGroundPath(context, from, alternative, point => !allowsBeach(point),
        undefined, .125, 512, allowsBeach);
      if (!beach) continue;
      const land = defaultGroundPath(context, alternative, to, ownBuilding);
      if (land) return [...beach, ...land];
    }
    return null;
  }
  return defaultGroundPath(context, from, to, ownBuilding);
};

export const setActorPath = (actor: SettlementActor, path: SettlementPoint[], phase: string) => {
  if (actor.phase !== phase) clearTrafficBlocker(actor);
  actor.path = path; actor.pathIndex = 0; actor.phase = phase;
  actor.queueTarget = undefined; actor.queueWait = 0; actor.queueKind = undefined;
  actor.action = actor.ware ? "carry" : "walk";
};
export { isOwnStockCourtyard } from "./settlement-entrance";
/**
 * SIM-CADENCE: walkers predict contacts on every second tick (staggered by uid). The 0.85 s
 * prediction horizon dwarfs one 50 ms tick, and the per-step contact test still runs every tick.
 */
const ANTICIPATION_PERIOD_TICKS = 2;
/** A unit held up this long by another turns toward where it is heading. */
const BLOCKED_FACING_DELAY = .15;
/** A reactive yield pauses on its shoulder; anticipated sidesteps and road shoves walk on. */
const arriveAtQueueTarget = (context: SettlementContext, actor: SettlementActor) => {
  const reactive = !actor.queueKind && !isHoldingStorageTurn(context, actor);
  actor.queueTarget = undefined; actor.queueKind = undefined;
  skipPassedWaypoints(context, actor);
  actor.queueWait = 0;
  if (!reactive) return;
  startYieldPause(actor);
  actor.action = "idle";
};
/**
 * SIM-CADENCE: after a failed proactive shoulder search the actor walks on for a quarter second
 * before it searches again; the contact rules (wait, yield, escape) still guard every step.
 */
const chooseProactiveShoulder = (context: SettlementContext, actor: SettlementActor,
  anticipated: SettlementActor, target: SettlementPoint, stationary: boolean) => {
  const tick = cadenceTick(context);
  if (tick !== undefined && (actor.shoulderRetryTick ?? 0) > tick) return null;
  const shoulder = chooseYieldTarget(context, actor, anticipated, target, stationary,
    point => canUseStockYieldPoint(context, actor, point));
  if (!shoulder && tick !== undefined) actor.shoulderRetryTick = tick + QUARTER_SECOND_TICKS;
  return shoulder;
};
/** The mover sidesteps an anticipated unit itself; only riders and mounts push idlers off the road. */
const anticipateTraffic = (
  context: SettlementContext, actor: SettlementActor, anticipated: SettlementActor, target: SettlementPoint
) => {
  const stationary = anticipated.pathIndex >= anticipated.path.length || !["walk", "carry"].includes(anticipated.action);
  if (stationary && isQueuedCourtPeer(context, actor, anticipated)) return target;
  // A pulled cart keeps its built stone lane and waits rather than sidestepping onto the shoulder.
  const shoulder = !actor.handcart && chooseProactiveShoulder(context, actor, anticipated, target, stationary);
  if (shoulder) {
    setQueueTarget(actor, shoulder, "proactive");
    if (stationary && !isMilitaryMover(actor)) spendProactiveSidestep(actor);
    trafficWork.proactiveShoulders++;
    return shoulder;
  }
  if (actor.mounted || actor.job === "Mount") requestStationaryRoadYield(context, anticipated, actor, target);
  return target;
};
/** Building a returning actor re-approaches: pickup source, home (entering/retiring) or workplace. */
const getReturningActorTargetUid = (actor: SettlementActor) => {
  if (actor.phase === "enterPickup") return actor.delivery?.source;
  return ["enterHome", "enterRetire"].includes(actor.phase) ? actor.home : actor.building;
};
const RETURNING_PHASES = new Set([
  "enterHome", "enterRetire", "enterAssigned", "enterRest", "enterPickup", "enterDelivery", "inputReturn",
  "settlerRelocateEnter"
]);
/**
 * Yielding on the road may leave a returning actor beside, rather than in, its doorway lane.
 * Rejoin the outside approach before crossing the plot; never widen the lane through masonry.
 * One left far from the door (a journey cut short) walks the long way back by the corridor.
 */
const rejoinReturningApproach = (context: SettlementContext, actor: SettlementActor) => {
  if (!RETURNING_PHASES.has(actor.phase)) return null;
  const uid = getReturningActorTargetUid(actor);
  const building = context.buildings.find((entry) => entry.uid === uid);
  if (!building) return null;
  const path = publicWalkPath(context, actor, building.workerApproach);
  return path ? [...path, building.doorThreshold] : null;
};

/**
 * The route planner proves a leg at ground-segment sample spacing. A thin sliver between those samples
 * (a stock crate's clearance meeting the plot edge) must not stop a walker forever on a planned leg
 * (TRAFFIC-01): the mover accepts the rest of the leg by the same test the planner used.
 */
const isPlannedLegClear = (context: SettlementContext, actor: SettlementActor, target: SettlementPoint) =>
  !actor.mounted && isGroundSegmentClear(context, actor, target, undefined,
    point => isOwnDoorLane(context, actor, point) || isOwnStockCourtyard(context, actor, point), false,
    point => isFishingShoreStep(context, actor, point));
/** The worker body needs a small margin outside an unfinished site to reach its interior stock pile. */
const isConstructionStockStep = (context: SettlementContext, actor: SettlementActor, reach: number) => {
  const building = actor.stockBuilding === undefined ? undefined : getBuilding(context, actor.stockBuilding);
  return !!building && building.construction < 1 && actor.phase === "deliveryStockWalk" &&
    !!actor.stockContact &&
    DMath.hypot(actor.x - actor.stockContact.approach.x, actor.z - actor.stockContact.approach.z) <= reach;
};
const isConstructionStockApproach = (context: SettlementContext, actor: SettlementActor) =>
  isConstructionStockStep(context, actor, 1.25);
const isConstructionStockHandoff = (context: SettlementContext, actor: SettlementActor) =>
  isConstructionStockStep(context, actor, 0.75);

const isOwnConstructionStockStep = (
  context: SettlementContext,
  actor: SettlementActor,
  point: SettlementPoint
) => {
  const building = actor.stockBuilding === undefined ? undefined : getBuilding(context, actor.stockBuilding);
  if (!building || building.construction >= 1 || !actor.stockContact) return false;
  return point.x >= building.x - building.width / 2 - WORKER_RADIUS &&
    point.x <= building.x + building.width / 2 + WORKER_RADIUS &&
    point.z >= building.z - building.depth / 2 - WORKER_RADIUS &&
    point.z <= building.z + building.depth / 2 + WORKER_RADIUS;
};

const moveActorStep = (context: SettlementContext, actor: SettlementActor, dt: number) => {
  // Other systems clear queue targets directly; a kind never outlives its target.
  if (!actor.queueTarget) actor.queueKind = undefined;
  const planned = actor.queueTarget ?? actor.path[actor.pathIndex];
  if (planned && !canEnterStockCourt(context, actor, planned)) {
    recordMovementOutcome(actor, "stock-wait");
    faceWaitingDestination(actor, dt); actor.action = "idle"; return false;
  }
  if (!isConstructionStockApproach(context, actor) && stockEntryRival(context, actor)) {
    actor.queueTarget = undefined; actor.queueKind = undefined;
    recordMovementOutcome(actor, "stock-wait");
    faceWaitingDestination(actor, dt); actor.action = "idle"; return false;
  }
  if (isConstructionStockHandoff(context, actor) && ((actor.queueWait ?? 0) > 0 || actor.queueTarget)) {
    actor.queueTarget = undefined; actor.queueKind = undefined; actor.queueWait = 0;
  }
  if (!admitStorageArrival(context,actor)) {
    recordMovementOutcome(actor, "door-queue"); faceWaitingDestination(actor, dt); actor.action = "idle"; return false;
  }
  if (!actor.visible) {
    const departure = getBuilding(context, passageBuilding(actor));
    // Raiders near the door: civilians stay inside, their work and deliveries wait (MIL-ASSAULT).
    if (civilianHeldInside(context, actor, departure)) { recordMovementOutcome(actor, "door-queue"); return false; }
    if (departure) prepareStorageDoorDeparture(actor, departure);
    if (!canBeginStorageExit(context,actor)) { recordMovementOutcome(actor, "door-queue"); return false; }
    if (!canLeaveDoor(context, actor)) { recordMovementOutcome(actor, "door-queue"); return false; }
    const squatter = doorstepSquatter(context, actor);
    if (squatter) { waitAtBlockedDoorstep(context, actor, squatter, dt); return false; }
    actor.visible = true;
    updatePersonTraffic(context, actor);
  }
  if ((actor.queueWait ?? 0) > 0) {
    recordMovementOutcome(actor, "yield-wait");
    updateYieldPause(context, actor, dt);
    faceWaitingDestination(actor, dt); actor.action = "idle"; return false;
  }
  actor.action = actor.ware ? "carry" : "walk";
  prepareRoadTravel(context, actor);
  const yielding = !!actor.queueTarget;
  const point = actor.queueTarget ?? actor.path[actor.pathIndex];
  if (!point) { recordMovementOutcome(actor, "arrived"); return true; }
  const passed = yielding ? "none" : passOccupiedWaypoint(context, actor, point);
  if (passed === "advanced") return false;
  if (passed === "arrived") {
    actor.pathIndex = actor.path.length; recordMovementOutcome(actor, "arrived"); return true;
  }
  let target = trafficTarget(context, actor, point);
  const movingSpeed = actor.locomotionSpeed ?? (actor.job === "Carrier" ? 1.2 : .9);
  const anticipates = !ownsStockCourt(context, actor) && !ownsStorageArrival(context, actor) &&
    !isAnticipationSuppressed(actor) && isCadenceSlot(context, actor.uid, ANTICIPATION_PERIOD_TICKS);
  const anticipated = anticipates ? anticipatedTrafficBlocker(context, actor, target, movingSpeed) : null;
  if (anticipated) target = anticipateTraffic(context, actor, anticipated, target);
  const dx = target.x - actor.x, dz = target.z - actor.z;
  const distance = DMath.hypot(dx, dz);
  const roadSpeed = ["Carrier", "Mount"].includes(actor.job) ? settlementRoadSpeedAt(context, actor) : 1;
  const groundSpeed = actorGroundSpeed(context, actor);
  const step = Math.min(distance, dt * groundSpeed * roadSpeed);
  const nextX = actor.x + (distance ? dx / distance * step : 0);
  const nextZ = actor.z + (distance ? dz / distance * step : 0);
  const { world } = context.options;
  if (nextX < 0 || nextZ < 0 || nextX >= world.cellsX || nextZ >= world.cellsZ) return false;
  const nextPoint = { x: nextX, z: nextZ };
  // A bridge awaiting removal takes nobody new; whoever is on it walks off.
  if (entersClosedDeck(context, actor, nextPoint)) {
    recordMovementOutcome(actor, "static-blocked"); actor.action = "idle"; return false;
  }
  if (context.options.corridorReservations &&
    isCorridorCellReserved(context, nextPoint, actor.uid) !== undefined) {
    recordMovementOutcome(actor, "person-blocked");
    faceWaitingDestination(actor, dt); actor.action = "idle"; return false;
  }
  const allowsFoundation=isOwnDoorLane(context,actor,nextPoint) || isOwnStockCourtyard(context,actor,nextPoint) ||
    isOwnConstructionStockStep(context, actor, nextPoint);
  const allowsBeach = isFishingShoreStep(context, actor, nextPoint);
  // A rider riding on over a narrow landing beach needs only a man's ground (owner, 2026-10-15).
  if ((actor.mounted && actor.phase !== ADVENTURE_BEACH && !isMountedNavigationClear(context, nextPoint)) ||
    (!isNavigationClear(context,nextPoint,allowsFoundation,allowsBeach) &&
      !isNavigationEscapeClear(context,actor,nextPoint,allowsFoundation) && !isPlannedLegClear(context, actor, target))) {
    recordMovementOutcome(actor, "static-blocked");
    // The rejoin shares the detour's throttle: a failed full-island search must not repeat every tick.
    const repair = findObstacleDetour(context, actor, dt, () => rejoinReturningApproach(context, actor));
    if (repair) setActorPath(actor, repair, actor.phase);
    return false;
  }
  // Priority favors older units, with a bounded escape when both directions are queued.
  // Keep the shoulder target until reached instead of immediately returning to the centerline.
  const blocked = firstNearbyTrafficActorWhere(context, nextPoint, actor.mounted ? 2.1 : 1.25, (other) =>
    other !== actor && other.visible && DMath.hypot(other.x - nextX, other.z - nextZ) < actorSeparation(actor, other) &&
    !isTrafficPassThrough(context, actor, other) && !isSeparatingTrafficStep(actor,other,{x:nextX,z:nextZ}));
  if (blocked) {
    recordTrafficBlocker(actor, blocked, dt);
    if (actor.timer > 2 && requestTrafficCycleBackout(context, actor)) return false;
    recordMovementOutcome(actor, "person-blocked");
    actor.timer += dt;
    if (actor.timer > BLOCKED_FACING_DELAY) faceWaitingDestination(actor, dt);
    if (actor.timer > 0.6) requestStationaryRoadYield(context, blocked, actor, target);
    if (actor.timer > 0.6 && !blocked.queueTarget && !isHoldingStorageTurn(context, blocked) && isShoveableIdler(blocked)) {
      const direction = { x: blocked.x + dx, z: blocked.z + dz };
      const shoulder = chooseYieldTarget(context, blocked, actor, direction, true, point=>canUseStockYieldPoint(context,blocked,point));
      if (shoulder) setQueueTarget(blocked, shoulder);
    }
    if (actor.timer > 0.6 && (!actor.queueTarget || actor.timer > 2) &&
      !isHoldingStorageTurn(context, actor)) {
      const close=DMath.hypot(actor.x-blocked.x,actor.z-blocked.z)<actorSeparation(actor,blocked)+.08;
      const escape=close ? {x:actor.x-(actor.z-blocked.z),z:actor.z+(actor.x-blocked.x)} : target;
      const yieldPoint = chooseCrowdEscapeTarget(context,actor,point=>canUseStockYieldPoint(context,actor,point)) ??
        chooseYieldTarget(context, actor, blocked, escape, actor.timer > 2 && blocked.timer > 1.2 && !blocked.queueTarget,
        point=>canUseStockYieldPoint(context,actor,point));
      if (yieldPoint) { setQueueTarget(actor, yieldPoint); actor.timer = 0; }
    }
    return false;
  }
  clearTrafficBlocker(actor);
  recordMovementOutcome(actor, "moving");
  actor.locomotionSpeed = groundSpeed * roadSpeed;
  actor.timer = 0; actor.x = nextX; actor.z = nextZ;
  updatePersonTraffic(context, actor);
  const heading = DMath.atan2(dx, dz);
  const steeringTime = step / (groundSpeed * roadSpeed);
  actor.yaw = turnYawToward(actor.yaw, heading, steeringTime * 6);
  actor.y = sampleSmooth(context.options.world, context.options.world.heights, actor.x, actor.z);
  if (distance <= step + 0.00001) {
    if (actor.queueTarget) arriveAtQueueTarget(context, actor);
    else actor.pathIndex++;
  }
  return !yielding && actor.pathIndex >= actor.path.length;
};
/** A led horse keeps its carrier's pace, so the pair moves together instead of stop-and-go. */

/** Consume leftover movement across sampled bends instead of slowing at every curve waypoint. */
export const moveActor = (context: SettlementContext, actor: SettlementActor, dt: number,
  onMove?: (distance: number) => void) => {
  // A removed bridge cut this journey: stand still (cargo kept) until a road route exists again.
  if (holdBridgeWait(context, actor, dt)) { recordMovementOutcome(actor, "interaction"); return false; }
  const executionEnabled = context.options.corridorReservations || context.options.eventMovement;
  if (executionEnabled) prepareRoadTravel(context, actor);
  if (!refreshRoadTravel(context, actor)) {
    recoverMovementExecution(context, actor);
    recordMovementOutcome(actor, "invalid-route"); return false;
  }
  // Plans are executor/corridor state; the default fixed path does not need one per actor per tick.
  if (executionEnabled) ensureWorkerMovementPlan(context, actor);
  if (context.options.corridorReservations && !movementExecutionEligible(actor))
    releaseCorridor(context, actor.uid);
  if (!actor.path?.length) releaseCorridor(context, actor.uid);
  let executorAllowed = false;
  if (context.options.corridorReservations && movementExecutionEligible(actor) && actor.path?.length) {
    const execution = beginMovementExecution(context, actor, actor.path, actor.phase);
    if (!execution.ok) {
      const blocker = context.actors.find(entry => entry.uid === execution.conflict);
      const target = actor.path[actor.pathIndex] ?? actor.path.at(-1);
      if (blocker && target) requestStationaryRoadYield(context, blocker, actor, target);
      markWorkerMovement(actor, "blocked", execution.safePoint);
      recordMovementOutcome(actor, "person-blocked");
      // Fall back to the fixed tick rather than stalling every actor behind an occupied destination.
    } else executorAllowed = true;
  }
  if (executorAllowed && context.options.eventMovement && movementExecutionEligible(actor)) {
    if (movementExecutionWake(context, actor) === "none") {
      const result = advanceMovementExecution(context, actor, dt);
      if (result === "arrived") return true;
      if (result === "moved") return false;
      // A deferral runs the ordinary fixed step in this same tick, not a skipped tick.
    } else movementExecutionWork.wakeFallbacks++;
  }
  tickYieldBudget(actor, dt);
  let remaining = dt;
  for (let attempt = 0; attempt < 16 && remaining > 1e-7; attempt++) {
    const x = actor.x, z = actor.z, index = actor.pathIndex, queued = actor.queueTarget;
    if (moveActorStep(context, actor, remaining)) {
      if (onMove) onMove(DMath.hypot(actor.x - x, actor.z - z));
      completeMovementExecution(context, actor);
      markWorkerMovement(actor, "arrived");
      return true;
    }
    const moved = DMath.hypot(actor.x - x, actor.z - z);
    onMove?.(moved);
    if (moved > 1e-9) refreshCorridor(context, actor.uid);
    markWorkerMovement(actor, movementOutcome(actor) === "moving" ? "moving" : "blocked",
      { x: actor.x, z: actor.z });
    const reachedWaypoint = actor.pathIndex !== index || queued !== actor.queueTarget;
    if (!reachedWaypoint || (actor.queueWait ?? 0) > 0) return false;
    remaining -= moved / (actor.locomotionSpeed ?? .9);
  }
  return false;
};

export const createActor = (context: SettlementContext, job: string, home: number, building = home) => {
  const origin = context.buildings.find((entry) => entry.uid === home)!;
  // Isolated worker fixtures may have no storage; actual simulation always starts with HQ.
  if (context.buildings.some(building => [0, 29, 39].includes(building.typeId))) {
    if (!takeIdleSettler(context, origin)) throw new Error("No idle settler in recruitment storage");
  } else context.settlers--;
  // A person recruited from an economy faction's storage belongs to that faction; the player's people
  // never gain the field, so their saves stay byte-identical. Only the player's people are on duty.
  const owner = economyOwnerOf(context, origin);
  if (owner === PLAYER_FACTION) countOnDuty(context, 1);
  const actor: SettlementActor = {
    uid: context.nextActor++, ...origin.doorThreshold, y: origin.y, yaw: 0, visible: false,
    job, action: "idle", ware: null, phase: "inside", building, home, path: [], pathIndex: 0,
    timer: 0, animationTime: 0
  };
  if (owner !== PLAYER_FACTION) actor.hostileCivilianFaction = owner;
  // A retired person is reused only inside its own economy (a `none` porter still counts as the player's).
  const reusable = context.actors.find(entry => entry.phase === "retired" &&
    actorEconomyOwnerOf(context, entry) === owner &&
    entry.job !== "Soldier" && entry.job !== "Mount" && entry.navalOrder === undefined &&
    !entry.ware && !entry.tool && !entry.delivery && !entry.demolitionReturning &&
    !Object.values(entry.consumed ?? {}).some(count => count > 0) &&
    !Object.values(entry.demolitionCargo ?? {}).some(count => count > 0) &&
    !context.buildings.some(building => building.worker === entry.uid));
  if (reusable) {
    const uid = reusable.uid;
    Object.assign(reusable, actor, { uid, navigationRecovery: undefined, navigationReturnCargo: undefined, locomotionSpeed: undefined, wareUnits: undefined, tool: undefined, target: undefined, delivery: undefined, nextDelivery: undefined, consumed: undefined, wareTransfer: undefined, stockContact: undefined, stockBuilding: undefined, storageArrivalOrder: undefined, storageArrivalBuilding: undefined, wareScale: undefined, productionInputs: undefined, preparedTarget: undefined, productionPath: undefined, afterInputPhase: undefined, treeFellingStarted: undefined, fieldWork: undefined, boatWork: undefined, navalOrder: undefined, sowingBatch: undefined, wellWork: undefined, foresterSeedling: undefined, queueTarget: undefined, queueWait: 0,
      ruinClearing: undefined, shoulderRetryTick: undefined, wallRepair: undefined });
    context.nextActor--;
    clearTrafficBlocker(reusable);
    renewActorIncarnation(reusable);
    return reusable;
  }
  context.actors.push(actor);
  return actor;
};
