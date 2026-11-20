import { TICK_SECONDS } from "../../../../island-of-settlers-shared/src/time/constants";
import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { getBuildingProductionRule } from "./production-rules";
import {
  type SettlementActorTickSystems,
  updateSettlementActorTick
} from "./settlement-actor-tick";
import { corridorReservation } from "./settlement-corridor-reservations";
import { updateDoorActivity } from "./settlement-door-activity";
import { beginStorageTrafficTick } from "./settlement-door-traffic";
import { turnYawToward } from "./settlement-geometry";
import { findOwnHeadquarters, isOwnHeadquarters } from "./settlement-home";
import { actorGroundSpeed } from "./settlement-movement-speed";
import { buildingNation } from "./settlement-nation";
import { isNavigationClear } from "./settlement-navigation";
import { cancelUnreachableTask } from "./settlement-navigation-cancellation";
import {
  beginActorMovement, recordMovementOutcome, updateNavigationRecovery
} from "./settlement-navigation-recovery";
import { setActorPath } from "./settlement-paths";
import { beginPersonTrafficTick, updatePersonTraffic } from "./settlement-person-index";
import { islandPeople, populationLimit } from "./settlement-population";
import { quietEnvironmentStatus, type QuietSkipSystems, ticksBeforeFactionAi } from "./settlement-quiet-skip";
import { beginNavigationRepairTick } from "./settlement-repair-budget";
import { updateReservationWatchdogs } from "./settlement-reservation-watchdog";
import { navigationRevisionKey } from "./settlement-revision-key";
import { updateStationaryRoadYield } from "./settlement-road-shoulders";
import { dispatchRuinClearing } from "./settlement-ruin-dispatch";
import { saveSurveyAssignments } from "./settlement-surveying";
import { actorSeparation } from "./settlement-traffic";
import { clearTrafficBlocker } from "./settlement-traffic-deadlock";
import type {
  SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint
} from "./settlement-types";
import { updateSettlementVision } from "./settlement-vision";
import { ensureWorkerMovementPlan } from "./settlement-worker-movement-plan";
import { updateWorker } from "./settlement-workers";
import { tickYieldBudget } from "./settlement-yield-budget";

export type MovementSkipSystems = QuietSkipSystems & SettlementActorTickSystems;

/**
 * Deterministic work counters for the movement fast-forward (they gate tests, not wall time), plus
 * diagnostic timers used by the D6 benchmark. The timers only observe the guard; they are not saved
 * and never feed a decision.
 */
const movementSkipWork = {
  actorTicks: 0,
  boundaryStops: 0,
  buildingChecks: 0,
  environmentChecks: 0,
  guardBackoffs: 0,
  guardChecks: 0,
  guardMs: 0,
  guardReuses: 0,
  legStops: 0,
  moveMs: 0,
  revalidateMs: 0,
  schedulerStops: 0,
  segments: 0
};
export const snapshotMovementSkipWork = () => ({ ...movementSkipWork });

/** Dispatch targets that own an actor before `updateWorker`; they stay on the fixed actor pipeline. */
const MOVEMENT_SKIP_SPECIAL_JOBS = new Set([
  "Builder", "Leveler", "Carrier", "Soldier", "Mount", "Recruit", "Scout", "Geologist", "Shipwright"
]);

/** A straight corridor this close to another actor's corridor is not independent enough to skip. */
const CORRIDOR_SEPARATION = 2;
/** Doors, stock courts and courtyards interact within this range of a building envelope. */
const CORRIDOR_BUILDING_CLEARANCE = 1.5;

interface MovementSkipPlan {
  actor: SettlementActor;
  path: readonly SettlementPoint[];
  pathIndex: number;
  revision: string;
  speed: number;
  /** Current position followed by the not-yet-reached waypoints; every leg is straight. */
  remaining: readonly SettlementPoint[];
}

interface MovementSkipSegment {
  plans: readonly MovementSkipPlan[];
  /**
   * Candidate only: ticks the current straight legs may advance before the first building envelope
   * clearance is reached. The exact tick owns that boundary; undefined means the prototype's
   * whole-route check applies instead.
   */
  legTicks?: number;
}

interface ClearStep {
  heading: number;
  nextX: number;
  nextZ: number;
  speed: number;
  steeringTime: number;
}

/**
 * The next fixed step would reach the end of the current straight leg (a waypoint turn or the final
 * goal): let the normal fixed tick own that boundary, then re-segment on the following leg.
 */
const nextMovementSkipStepArrives = (context: SettlementContext, actor: SettlementActor) => {
  const target = actor.path[actor.pathIndex];
  if (!target) return true;
  return DMath.hypot(target.x - actor.x, target.z - actor.z) <=
    TICK_SECONDS * actorGroundSpeed(context, actor) + 0.00001;
};

/**
 * A deliberately narrow guard for a plain outbound walker: the remaining straight legs, no cargo,
 * handling, queue, timer, door, stock, traffic or recovery interaction. Multiple independent
 * walkers may share the fast path; their full remaining routes are checked against each other
 * first. Intermediate waypoints stay on the fixed pipeline, so a turn is never skipped.
 */
const movementSkipActorEligible = (context: SettlementContext, actor: SettlementActor) => {
  if (!actor.visible || actor.phase !== "outbound" || actor.action !== "walk") return false;
  if (MOVEMENT_SKIP_SPECIAL_JOBS.has(actor.job)) return false;
  if (actor.mounted || actor.handcart !== undefined || actor.navalOrder !== undefined ||
    actor.boatWork !== undefined || actor.demolitionReturning) return false;
  if (actor.delivery !== undefined || actor.stockContact !== undefined ||
    actor.wareTransfer !== undefined || actor.target !== undefined ||
    actor.queueTarget !== undefined || (actor.queueWait ?? 0) > 0 || actor.timer !== 0 ||
    actor.ware != null || actor.workerMovementPlan !== undefined ||
    actor.workerHandlingPlan !== undefined || actor.navigationRecovery?.blocked ||
    actor.sowingBatch !== undefined || actor.wellWork !== undefined ||
    actor.foresterSeedling !== undefined || actor.fieldWork !== undefined)
    return false;
  // A restored corridor would be refreshed by `moveActor`; keep that state on the fixed pipeline.
  if (corridorReservation(context, actor.uid)) return false;
  // Any remaining straight leg can be advanced. The next waypoint (turn, door or final goal) always
  // belongs to the fixed actor pipeline; the segment loop stops before its arrival step.
  if (actor.path.length < 2 || actor.pathIndex < 0 || actor.pathIndex >= actor.path.length)
    return false;
  const building = context.buildings.find(entry => entry.uid === actor.building);
  return building !== undefined && building.construction === 1 && building.worker === actor.uid;
};

const buildingEdgeDistance = (point: SettlementPoint, building: SettlementBuilding) => {
  const x = Math.max(0, Math.abs(point.x - building.x) - building.width / 2);
  const z = Math.max(0, Math.abs(point.z - building.z) - building.depth / 2);
  return DMath.hypot(x, z);
};

const pointSegmentDistance = (point: SettlementPoint, start: SettlementPoint, end: SettlementPoint) => {
  const dx = end.x - start.x, dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared > 0
    ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared))
    : 0;
  return DMath.hypot(point.x - (start.x + dx * t), point.z - (start.z + dz * t));
};

const orientation = (a: SettlementPoint, b: SettlementPoint, c: SettlementPoint) =>
  (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);

const segmentsIntersect = (a: SettlementPoint, b: SettlementPoint,
  c: SettlementPoint, d: SettlementPoint) => {
  const first = orientation(a, b, c), second = orientation(a, b, d);
  const third = orientation(c, d, a), fourth = orientation(c, d, b);
  if (((first > 0 && second < 0) || (first < 0 && second > 0)) &&
    ((third > 0 && fourth < 0) || (third < 0 && fourth > 0))) return true;
  const onSegment = (point: SettlementPoint, start: SettlementPoint, end: SettlementPoint) =>
    point.x >= Math.min(start.x, end.x) && point.x <= Math.max(start.x, end.x) &&
    point.z >= Math.min(start.z, end.z) && point.z <= Math.max(start.z, end.z);
  return (first === 0 && onSegment(c, a, b)) || (second === 0 && onSegment(d, a, b)) ||
    (third === 0 && onSegment(a, c, d)) || (fourth === 0 && onSegment(b, c, d));
};

const segmentDistance = (a: SettlementPoint, b: SettlementPoint,
  c: SettlementPoint, d: SettlementPoint) => {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
};

/** A plan's remaining route starts at the actor's current position and then follows every waypoint. */
const remainingPolyline = (actor: SettlementActor): SettlementPoint[] => [
  { x: actor.x, z: actor.z }, ...actor.path.slice(actor.pathIndex)
];

interface CorridorSegment {
  start: SettlementPoint;
  end: SettlementPoint;
}

const remainingCorridorSegments = (plan: MovementSkipPlan): CorridorSegment[] => {
  const segments: CorridorSegment[] = [];
  for (let index = 1; index < plan.remaining.length; index++)
    segments.push({ start: plan.remaining[index - 1]!, end: plan.remaining[index]! });
  return segments;
};

/**
 * Two walkers may share the fast path only while every remaining straight leg stays apart. The
 * whole polyline is checked, not just the current leg: a later corner must not bring them together.
 */
const corridorsIndependent = (
  left: readonly CorridorSegment[], right: readonly CorridorSegment[], separation: number
) => {
  for (const a of left)
    for (const b of right)
      if (segmentDistance(a.start, a.end, b.start, b.end) <= separation) return false;
  return true;
};

const movementSkipCorridorsIndependent = (plans: readonly MovementSkipPlan[]) => {
  const routes = plans.map(remainingCorridorSegments);
  for (let first = 0; first < plans.length; first++) {
    const a = plans[first]!;
    for (let second = first + 1; second < plans.length; second++) {
      const b = plans[second]!;
      if (!corridorsIndependent(routes[first]!, routes[second]!,
        actorSeparation(a.actor, b.actor) + CORRIDOR_SEPARATION)) return false;
    }
  }
  return true;
};

/** Every remaining leg must stay outside every door/stock/building envelope. */
const movementSkipCorridorClearOfBuildings = (
  context: SettlementContext, plan: MovementSkipPlan
) => {
  for (const segment of remainingCorridorSegments(plan)) {
    const start = segment.start, end = segment.end;
    const length = DMath.hypot(end.x - start.x, end.z - start.z);
    const samples = Math.max(1, Math.ceil(length / .25));
    for (let sample = 0; sample <= samples; sample++) {
      const t = samples ? sample / samples : 0;
      const point = { x: start.x + (end.x - start.x) * t,
        z: start.z + (end.z - start.z) * t };
      for (const building of context.buildings)
        if (buildingEdgeDistance(point, building) <= CORRIDOR_BUILDING_CLEARANCE) return false;
    }
  }
  return true;
};

/**
 * The first parameter in [0, 1] where a straight leg enters a building's expanded envelope. The
 * guard treats the envelope as the axis-aligned footprint plus `CORRIDOR_BUILDING_CLEARANCE`; this
 * slab intersection is the exact entry point of that conservative zone along the leg.
 */
const buildingBoundaryParameter = (
  context: SettlementContext, start: SettlementPoint, end: SettlementPoint
) => {
  const dx = end.x - start.x, dz = end.z - start.z;
  let first = 1;
  for (const building of context.buildings) {
    let near = 0, far = 1;
    const slab = (origin: number, direction: number, min: number, max: number) => {
      if (Math.abs(direction) < 1e-12) return origin >= min && origin <= max;
      let a = (min - origin) / direction, b = (max - origin) / direction;
      if (a > b) [a, b] = [b, a];
      near = Math.max(near, a); far = Math.min(far, b);
      return near <= far;
    };
    if (!slab(start.x, dx, building.x - building.width / 2 - CORRIDOR_BUILDING_CLEARANCE,
      building.x + building.width / 2 + CORRIDOR_BUILDING_CLEARANCE) ||
      !slab(start.z, dz, building.z - building.depth / 2 - CORRIDOR_BUILDING_CLEARANCE,
        building.z + building.depth / 2 + CORRIDOR_BUILDING_CLEARANCE)) continue;
    if (near <= 0) return 0;
    if (near < first) first = near;
  }
  return first;
};

/**
 * Candidate segmentation: ticks that may be skipped on the current straight leg before the exact
 * pipeline must own a building envelope/door boundary. Zero means the actor is already at (or
 * inside) a boundary and this tick must stay exact.
 */
const movementSkipCurrentLegTicks = (context: SettlementContext, plan: MovementSkipPlan) => {
  const actor = plan.actor;
  const target = actor.path[actor.pathIndex];
  if (!target) return 0;
  const distance = DMath.hypot(target.x - actor.x, target.z - actor.z);
  if (distance <= 1e-9) return 0;
  const boundary = buildingBoundaryParameter(context, actor, target);
  if (boundary <= 0) return 0;
  const step = TICK_SECONDS * plan.speed;
  // Leave the boundary tick to the exact actor pipeline. The tiny epsilon keeps a tick that lands
  // exactly on the expanded envelope outside the skipped stretch.
  return Math.max(0, Math.floor((boundary * distance - 1e-6) / Math.max(step, 1e-9)));
};

/**
 * Every building must be inert for the skipped stretch: the home shell or a completed, paused
 * production building owned by one of the fast walkers. Drink-chain inputs return themselves to
 * storage every fixed tick, so those buildings stay on the normal pipeline.
 */
const movementSkipBuildingsQuiet = (
  context: SettlementContext, plans: readonly MovementSkipPlan[]
) => {
  const workBuildings = new Map(plans.map(plan => [plan.actor.building, plan.actor]));
  for (const building of context.buildings) {
    const worker = workBuildings.get(building.uid);
    if (worker) {
      const rule = getBuildingProductionRule(building, buildingNation(context, building));
      if (!rule || building.worker !== worker.uid || building.productionPaused !== true ||
        building.working || building.workshopUpgrade !== undefined ||
        (building.handcarts ?? 0) > 0 || building.typeId === 5 || building.typeId === 6 ||
        !Object.entries(building.input ?? {}).every(([ware]) => rule.inputs.includes(ware)) ||
        !rule.inputs.every(ware => (building.input[ware] ?? 0) > 0) ||
        building.productionOrders !== undefined || building.selectedOutput !== undefined ||
        building.handcartMode !== undefined || building.shipReserve !== undefined ||
        building.fisherMode !== undefined || building.fisherBoat !== undefined ||
        building.pigFeedPhase !== undefined || building.wellBucketTaken !== undefined ||
        building.nurserySeedlingTaken !== undefined ||
        Object.keys(building.output ?? {}).length ||
        Object.keys(building.incoming ?? {}).length ||
        Object.keys(building.required ?? {}).length) return false;
      continue;
    }
    if (!isOwnHeadquarters(building) || building.construction !== 1 || building.worker !== undefined ||
      building.working || building.workshopUpgrade !== undefined || (building.handcarts ?? 0) > 0 ||
      Object.keys(building.input ?? {}).length || Object.keys(building.output ?? {}).length ||
      Object.keys(building.incoming ?? {}).length || Object.keys(building.required ?? {}).length)
      return false;
  }
  return true;
};

/**
 * Revalidates the whole fast-forward segment once: all actors are plain outbound walkers, the
 * home/paused-workplace building set is inert, the island is otherwise quiet and every remaining
 * corridor is independent. The transient plan is created and removed again, borrowing only the
 * wake bound so the saved actor state stays identical to an exact run.
 */
const movementSkipSegment = (
  context: SettlementContext, systems: MovementSkipSystems, segmented: boolean
): MovementSkipSegment | undefined => {
  movementSkipWork.guardChecks++;
  if (context.accumulator !== 0 || context.actors.length === 0) return undefined;
  // The executor/corridor rule set changes movement itself; only the plain exact lane is proven.
  if (context.options.corridorReservations || context.options.eventMovement) return undefined;
  const currentTick = context.clock?.tick() ?? 0;
  const surveyEntries = saveSurveyAssignments(context);
  const surveys = surveyEntries.length
    ? new Set(surveyEntries.map(([uid]) => uid)) : undefined;
  const plans: MovementSkipPlan[] = [];
  for (const actor of context.actors) {
    if (!movementSkipActorEligible(context, actor) || surveys?.has(actor.uid)) return undefined;
    const transient = ensureWorkerMovementPlan(context, actor);
    if (!transient) return undefined;
    const expectedArriveTick = transient.expectedArriveTick;
    actor.workerMovementPlan = undefined;
    // `expectedArriveTick` is the wake bound; the final arrival tick always runs normally.
    if (expectedArriveTick <= currentTick + 1 || nextMovementSkipStepArrives(context, actor))
      return undefined;
    const target = actor.path[actor.pathIndex];
    if (!target) return undefined;
    plans.push({
      actor,
      path: actor.path,
      pathIndex: actor.pathIndex,
      revision: navigationRevisionKey(context),
      speed: actorGroundSpeed(context, actor),
      remaining: remainingPolyline(actor)
    });
  }
  if (!movementSkipCorridorsIndependent(plans)) return undefined;
  // The prototype proves the whole remaining polyline clear before it starts. The segmented
  // candidate only needs the current leg up to its first building boundary; turns and the boundary
  // itself are owned by exact ticks, then the next segment is proved afresh.
  if (!segmented && !plans.every(plan => movementSkipCorridorClearOfBuildings(context, plan)))
    return undefined;
  movementSkipWork.buildingChecks++;
  if (!movementSkipBuildingsQuiet(context, plans)) return undefined;
  const home = findOwnHeadquarters(context);
  // Population growth is the only home-building timer; at the cap every scheduler fire returns.
  if (home && islandPeople(context) < populationLimit(context, home)!) return undefined;
  movementSkipWork.environmentChecks++;
  if (!quietEnvironmentStatus(context, systems).quiet) return undefined;
  if (!segmented) return { plans };
  const legTicks = Math.min(...plans.map(plan => movementSkipCurrentLegTicks(context, plan)));
  if (!Number.isFinite(legTicks) || legTicks <= 0) return undefined;
  return { plans, legTicks };
};

/**
 * Candidate revalidation: the same exact proof as a fresh segment, re-run at a bounded interval.
 * The island's state can only change through the systems the full guard has just proved no-ops
 * (and through `onTickStart`, whose navigation changes the per-tick revision check catches), so the
 * proof remains valid for the bounded window. Any doubt falls back before the tick.
 */
const movementSkipRevalidate = (
  context: SettlementContext, systems: MovementSkipSystems, plans: readonly MovementSkipPlan[]
) => {
  const started = performance.now();
  movementSkipWork.guardChecks++;
  if (context.accumulator !== 0) return false;
  if (!plans.every(plan => movementSkipActorStillCurrent(context, plan))) return false;
  if (!plans.every(plan => movementSkipCurrentLegTicks(context, plan) > 0)) return false;
  movementSkipWork.buildingChecks++;
  if (!movementSkipBuildingsQuiet(context, plans)) return false;
  movementSkipWork.environmentChecks++;
  if (!quietEnvironmentStatus(context, systems).quiet) return false;
  movementSkipWork.revalidateMs += performance.now() - started;
  return true;
};

/**
 * Ticks the segmented guard may trust one proof. Half a second is one scheduler period; the full
 * guard already proves the population/stone/trade/colony/adventure scheduler fire a no-op (the
 * prototype skips it per tick too). The whole stretch is re-proved before the next nine ticks, so
 * any state change outside that proof falls back before a skip.
 */
const MOVEMENT_SKIP_GUARD_TICKS = 9;
const movementSkipGuardWindow = () => MOVEMENT_SKIP_GUARD_TICKS;

const movementSkipActorStillCurrent = (context: SettlementContext, plan: MovementSkipPlan) => {
  const actor = plan.actor;
  return actor.path === plan.path && actor.pathIndex === plan.pathIndex &&
    actor.phase === "outbound" && actor.visible && actor.timer === 0 &&
    actor.queueTarget === undefined && (actor.queueWait ?? 0) === 0 && actor.ware == null &&
    actor.delivery === undefined && actor.stockContact === undefined &&
    actor.wareTransfer === undefined && actor.target === undefined &&
    actor.workerHandlingPlan === undefined && !actor.navigationRecovery?.blocked &&
    navigationRevisionKey(context) === plan.revision;
};

/**
 * The exact arithmetic of `moveActorStep`'s clear straight-leg branch. The guard proves every
 * check it omits a no-op for the whole segment; the position, yaw, ground-height and steering
 * arithmetic stay byte-for-byte the same.
 */
const clearStepPlan = (
  context: SettlementContext, actor: SettlementActor, speed: number
): ClearStep | undefined => {
  const target = actor.path[actor.pathIndex];
  if (!target) return undefined;
  const dx = target.x - actor.x, dz = target.z - actor.z;
  const distance = DMath.hypot(dx, dz);
  const step = Math.min(distance, TICK_SECONDS * speed);
  // The arrival tick is a boundary and always runs through the normal pipeline.
  if (distance <= step + 0.00001) return undefined;
  const nextX = actor.x + (distance ? dx / distance * step : 0);
  const nextZ = actor.z + (distance ? dz / distance * step : 0);
  const { world } = context.options;
  if (nextX < 0 || nextZ < 0 || nextX >= world.cellsX || nextZ >= world.cellsZ) return undefined;
  if (!isNavigationClear(context, { x: nextX, z: nextZ })) return undefined;
  return {
    heading: DMath.atan2(dx, dz), nextX, nextZ, speed,
    steeringTime: step / speed
  };
};

const applyClearStep = (
  context: SettlementContext, actor: SettlementActor, clear: ClearStep, dt: number
) => {
  tickYieldBudget(actor, dt);
  actor.action = "walk";
  actor.queueKind = undefined;
  actor.timer = 0;
  actor.locomotionSpeed = clear.speed;
  actor.x = clear.nextX;
  actor.z = clear.nextZ;
  clearTrafficBlocker(actor);
  recordMovementOutcome(actor, "moving");
  updatePersonTraffic(context, actor);
  actor.yaw = turnYawToward(actor.yaw, clear.heading, clear.steeringTime * 6);
  actor.y = sampleSmooth(context.options.world, context.options.world.heights, actor.x, actor.z);
};

/**
 * The exact subset of `updateSettlementActorTick` for a guarded outbound walker. Returns true
 * when the tick crossed a boundary, so the caller stops the segment after finishing this tick.
 */
const advanceMovementSkipActor = (
  context: SettlementContext, plan: MovementSkipPlan, clear: ClearStep, dt: number
) => {
  const actor = plan.actor;
  const previousPhase = actor.phase, previousAction = actor.action, previousVisible = actor.visible;
  beginActorMovement(actor);
  // `tickMask.animationTime` is set by the offline lane; the fixed actor pipeline honours it.
  if (!context.options.tickMask?.animationTime) actor.animationTime += dt;
  if (updateStationaryRoadYield(context, actor, dt)) {
    updatePersonTraffic(context, actor);
    if (actor.phase !== previousPhase || actor.action !== previousAction) actor.animationTime = 0;
    return true;
  }
  // A shoulder anchor may have queued a spot; hand that tick back to the exact worker pipeline.
  if (actor.queueTarget !== undefined || !movementSkipActorStillCurrent(context, plan)) {
    updateWorker(context, actor, dt);
  } else {
    applyClearStep(context, actor, clear, dt);
  }
  updateNavigationRecovery(context, actor, dt,
    path => setActorPath(actor, path, actor.phase), () => cancelUnreachableTask(context, actor));
  // `applyClearStep` already indexed the new cell. Recovery only needs a refresh if it changed
  // membership (phase/visibility); otherwise this would repeat the same map lookup each tick.
  if (actor.phase !== previousPhase || actor.visible !== previousVisible)
    updatePersonTraffic(context, actor);
  if (actor.phase !== previousPhase || actor.action !== previousAction) actor.animationTime = 0;
  return !movementSkipActorStillCurrent(context, plan);
};

const updateMovementSkipDoors = (context: SettlementContext) => {
  if (!context.options.tickMask?.doorActivity &&
    context.buildings.some(building => building.door > 0)) updateDoorActivity(context, TICK_SECONDS);
};

/**
 * One fixed tick with the guarded actor arithmetic instead of the full actor/global pipeline.
 * Returns true when this tick crossed a boundary; the segment stops after it.
 */
const advanceMovementSkipTick = (
  context: SettlementContext, systems: MovementSkipSystems, plans: readonly MovementSkipPlan[]
) => {
  const gameTick = context.clock?.tick() ?? 0;
  // The live loop adds one step before the tick; keep that residue visible to onTickStart/actors.
  context.accumulator += TICK_SECONDS;
  context.randomAudit?.setTick(gameTick);
  context.options.onTickStart?.(TICK_SECONDS, gameTick);
  beginStorageTrafficTick(context, TICK_SECONDS);
  updateReservationWatchdogs(context, TICK_SECONDS);
  beginNavigationRepairTick(context, TICK_SECONDS);
  systems.military.advanceQuiet(TICK_SECONDS);
  context.scheduling += TICK_SECONDS;
  if (context.scheduling >= .5) {
    context.scheduling -= .5;
    // Waiting ruins retry on the same ticks as in exact play (quiet guard: `ruinsQuiet`).
    dispatchRuinClearing(context);
  }
  // The fixed tick rebuilds the person index every tick; the fast path keeps membership exact by
  // updating each actor after its step, so the rebuild is a proven no-op here.
  const clears = plans.map(plan => movementSkipActorStillCurrent(context, plan)
    ? clearStepPlan(context, plan.actor, plan.speed) : undefined);
  if (clears.some(clear => clear === undefined)) {
    // `onTickStart` may have changed navigation between the segment guard and this tick: run this
    // tick through the exact fixed actor pipeline, then stop segment skipping at the boundary.
    beginPersonTrafficTick(context);
    for (const actor of context.actors.slice())
      updateSettlementActorTick(context, systems, actor, TICK_SECONDS);
    movementSkipWork.actorTicks += plans.length;
    systems.trade.update(TICK_SECONDS);
    updateMovementSkipDoors(context);
    updateSettlementVision(context);
    context.accumulator -= TICK_SECONDS;
    return true;
  }
  let boundary = false;
  plans.forEach((plan, index) => {
    if (advanceMovementSkipActor(context, plan, clears[index]!, TICK_SECONDS)) boundary = true;
    movementSkipWork.actorTicks++;
  });
  systems.trade.update(TICK_SECONDS);
  updateMovementSkipDoors(context);
  // The walkers explore cell by cell exactly as the fixed tick's last phase would.
  updateSettlementVision(context);
  context.accumulator -= TICK_SECONDS;
  return boundary;
};

export interface MovementSkipClock {
  advance(ticks: number): void;
  tick(): number;
}

/**
 * The original prototype guard: prove the whole remaining route once, then re-run the environment
 * and building proofs before every skipped tick. Kept selectable only for the D6 benchmark.
 */
const createPrototypeMovementSkipTicker = (
  context: SettlementContext, systems: MovementSkipSystems, clock: MovementSkipClock
) => (ticks: number) => {
  if (!Number.isSafeInteger(ticks) || ticks <= 0) return 0;
  let advanced = 0;
  while (advanced < ticks) {
    const segmentStarted = performance.now();
    const segment = movementSkipSegment(context, systems, false);
    movementSkipWork.guardMs += performance.now() - segmentStarted;
    if (!segment) break;
    let segmentTicks = 0;
    let boundary = false;
    while (segmentTicks < ticks - advanced) {
      // State and arrival boundaries are checked before the tick so the normal fixed tick owns them.
      if (segment.plans.some(plan => !movementSkipActorStillCurrent(context, plan) ||
        nextMovementSkipStepArrives(context, plan.actor))) break;
      // The environment/buildings can change without a navigation revision; stop before skipping
      // a tick whose scheduler/cleanup work the fast path does not run.
      if (context.accumulator !== 0) break;
      const guardStarted = performance.now();
      movementSkipWork.environmentChecks++;
      const environmentQuiet = quietEnvironmentStatus(context, systems).quiet;
      movementSkipWork.buildingChecks++;
      const quiet = environmentQuiet && movementSkipBuildingsQuiet(context, segment.plans);
      movementSkipWork.guardMs += performance.now() - guardStarted;
      if (!quiet) break;
      boundary = advanceMovementSkipTick(context, systems, segment.plans);
      clock.advance(1);
      segmentTicks++;
      if (boundary) break;
    }
    if (segmentTicks === 0) break;
    advanced += segmentTicks;
    movementSkipWork.segments++;
    if (boundary) {
      movementSkipWork.boundaryStops++;
      break;
    }
  }
  return advanced;
};

/**
 * Candidate D6 guard: prove a bounded stretch once, then advance its exact low-level movement
 * arithmetic without repeating the full island proof every tick. The proof is re-run at every
 * scheduler boundary and before the first tick that would enter a building envelope/door; any
 * failed check ends the segment and the normal fixed tick owns the boundary. The skipped ticks
 * still advance the clock, accumulator, scheduling residue, runtime lane, storage/reservation/
 * repair clocks, quiet military clock, trade clock and each walker's person-index entry.
 */
const createSegmentedMovementSkipTicker = (
  context: SettlementContext, systems: MovementSkipSystems, clock: MovementSkipClock
) => {
  // A failed segment means this tick is exact. Re-probing every tick only repeats the same proof;
  // back off for one scheduler period. This can only miss a new skip opportunity, never a tick.
  let retryAtTick = 0;
  return (ticks: number) => {
    if (!Number.isSafeInteger(ticks) || ticks <= 0) return 0;
    if ((context.clock?.tick() ?? 0) < retryAtTick) return 0;
    let advanced = 0;
    while (advanced < ticks) {
      const segmentStarted = performance.now();
      const segment = movementSkipSegment(context, systems, true);
      movementSkipWork.guardMs += performance.now() - segmentStarted;
      if (!segment || segment.legTicks === undefined) {
        retryAtTick = (context.clock?.tick() ?? 0) + MOVEMENT_SKIP_GUARD_TICKS + 1;
        movementSkipWork.guardBackoffs++;
        break;
      }
      let segmentTicks = 0, boundary = false, guardTicks = 0;
      while (segmentTicks < ticks - advanced) {
        // The exact pipeline owns the tick that would reach the current leg's building boundary.
        if (segmentTicks >= segment.legTicks) {
          movementSkipWork.legStops++;
          break;
        }
        // Cheap per-tick state/arrival/revision checks; any change hands the tick to the exact path.
        if (segment.plans.some(plan => !movementSkipActorStillCurrent(context, plan) ||
          nextMovementSkipStepArrives(context, plan.actor))) break;
        if (guardTicks === 0) {
          if (!movementSkipRevalidate(context, systems, segment.plans)) break;
          guardTicks = movementSkipGuardWindow();
          if (guardTicks <= 0) {
            movementSkipWork.schedulerStops++;
            break;
          }
          movementSkipWork.guardReuses++;
        }
        if (context.accumulator !== 0) break;
        const moveStarted = performance.now();
        boundary = advanceMovementSkipTick(context, systems, segment.plans);
        movementSkipWork.moveMs += performance.now() - moveStarted;
        clock.advance(1);
        segmentTicks++;
        guardTicks--;
        if (boundary) break;
      }
      if (segmentTicks === 0) break;
      advanced += segmentTicks;
      movementSkipWork.segments++;
      if (boundary) {
        movementSkipWork.boundaryStops++;
        break;
      }
      if (segmentTicks >= segment.legTicks) break;
    }
    return advanced;
  };
};

/**
 * Builds the simulation's opt-in `advanceMovementSkipTicks`: revalidate a segment, then run its
 * exact low-level movement arithmetic for as many ticks as the guards allow. The tick counter and
 * `observeTicks` listeners do not advance for skipped ticks (the same choice as quiet skip). Like the
 * quiet skip, it stops before the economy AI's next due tick (EAI5b).
 */
export const createMovementSkipTicker = (
  context: SettlementContext, systems: MovementSkipSystems, clock: MovementSkipClock
) => {
  const ticker = context.options.movementSkipGuard === "segmented"
    ? createSegmentedMovementSkipTicker(context, systems, clock)
    : createPrototypeMovementSkipTicker(context, systems, clock);
  return (ticks: number) => ticker(Math.min(ticks, ticksBeforeFactionAi(context)));
};
