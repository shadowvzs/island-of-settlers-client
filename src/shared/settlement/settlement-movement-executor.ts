import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { getBuilding } from "./settlement-building-index";
import {
  acquireCorridor, corridorReservation, refreshCorridor, releaseCorridor
} from "./settlement-corridor-reservations";
import { turnYawToward } from "./settlement-geometry";
import { actorGroundSpeed, actorRoadSpeed } from "./settlement-movement-speed";
import { recordMovementOutcome } from "./settlement-navigation-recovery";
import { forEachNearbyTrafficActor, updatePersonTraffic } from "./settlement-person-index";
import { navigationRevisionKey } from "./settlement-revision-key";
import { actorSeparation } from "./settlement-traffic";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";
import { ensureWorkerMovementPlan, invalidateWorkerMovementPlan } from "./settlement-worker-movement-plan";
import { tickYieldBudget } from "./settlement-yield-budget";

export interface MovementExecution {
  conflict?: number;
  ok: boolean;
  safePoint: SettlementPoint;
}

/** A safe skip ("moved"), a completed path ("arrived"), or a deferral to the fixed tick. */
export type MovementExecutionResult = "arrived" | "handoff" | "moved";

export type MovementWakeReason =
  | "none"
  | "arrival"
  | "cargo"
  | "door"
  | "storage"
  | "traffic"
  | "invalidated";

/** Deterministic executor work counters; they gate CI instead of wall-clock timing. */
export const movementExecutionWork = {
  admissionFailures: 0,
  admissionNoRoute: 0,
  admissionReservation: 0,
  admissionStationary: 0,
  advanceArrivals: 0,
  advanceHandoffs: 0,
  advanceTicks: 0,
  wakeFallbacks: 0
};
export const snapshotMovementExecutionWork = () => ({ ...movementExecutionWork });
export const resetMovementExecutionWork = () => {
  for (const key of Object.keys(movementExecutionWork) as (keyof typeof movementExecutionWork)[])
    movementExecutionWork[key] = 0;
};

/** Mirrors the door queue's admission range; crossing it is an authoritative executor boundary. */
const EXECUTOR_ADMISSION_RANGE = 2.5;
const ADMISSION_PHASES = new Set(["home", "pickup", "deliver", "inputApproach", "outputWalk",
  "pickupStockWalk", "deliveryStockWalk", "foresterPickupWalk", "foresterReturnWalk",
  "foresterPlantWalk"]);
const buildingEdgeDistance = (
  actor: SettlementActor, building: { depth: number; width: number; x: number; z: number }
) => {
  const x = Math.max(0, Math.abs(actor.x - building.x) - building.width / 2);
  const z = Math.max(0, Math.abs(actor.z - building.z) - building.depth / 2);
  return DMath.hypot(x, z);
};
const executorAdmissionAhead = (context: SettlementContext, actor: SettlementActor) => {
  if (!ADMISSION_PHASES.has(actor.phase)) return false;
  let uid: number | undefined;
  if (actor.phase === "home") uid = actor.home;
  else if (actor.phase === "pickup") uid = actor.delivery?.source;
  else if (actor.phase === "deliver") uid = actor.delivery?.destination;
  let contact: SettlementPoint | undefined;
  if (actor.phase === "foresterPlantWalk") contact = actor.target;
  else if (uid === undefined) contact = actor.stockContact?.approach;
  else contact = getBuilding(context, uid)?.access;
  if (contact && DMath.hypot(actor.x - contact.x, actor.z - contact.z) <= EXECUTOR_ADMISSION_RANGE)
    return true;
  // A stock court claim can rewrite the path before its contact is within range: hand the whole
  // building envelope back to the fixed tick instead of skipping the admission check.
  const stockBuilding = getBuilding(context, actor.stockBuilding);
  return !!stockBuilding && buildingEdgeDistance(actor, stockBuilding) <= EXECUTOR_ADMISSION_RANGE;
};

/** How far ahead the executor looks for a body before handing the approach to the fixed tick. */
const EXECUTOR_TRAFFIC_LOOKAHEAD = 1.8;
const bodyRadius = (actor: SettlementActor) => {
  if (actor.mounted) return 1.05;
  return actor.handcart ? .45 : .3;
};
const executorBodyAhead = (context: SettlementContext, actor: SettlementActor) => {
  if (!context.actors?.length) return undefined;
  let remaining = EXECUTOR_TRAFFIC_LOOKAHEAD;
  let from: SettlementPoint = { x: actor.x, z: actor.z };
  /** Widest body (mounted) keeps the nearby query a safe superset; the exact test follows. */
  const queryRadius = bodyRadius(actor) + 1.05 + .15;
  for (let index = actor.pathIndex; index < actor.path.length && remaining > 1e-9; index++) {
    const to = actor.path[index]!;
    const distance = DMath.hypot(to.x - from.x, to.z - from.z);
    const travel = Math.min(distance, remaining);
    const samples = Math.max(1, Math.ceil(travel / .25));
    for (let sample = 1; sample <= samples; sample++) {
      const amount = distance > 1e-9
        ? Math.min(1, travel * sample / samples / distance) : 0;
      const x = from.x + (to.x - from.x) * amount;
      const z = from.z + (to.z - from.z) * amount;
      let hit: number | undefined;
      forEachNearbyTrafficActor(context, { x, z }, queryRadius, other => {
        if (other.uid === actor.uid || !other.visible) return false;
        if (DMath.hypot(other.x - x, other.z - z) < bodyRadius(actor) + bodyRadius(other) + .15) {
          hit = other.uid;
          return true;
        }
        return false;
      });
      if (hit !== undefined) return hit;
    }
    remaining -= travel;
    from = to;
    if (distance <= 1e-9) continue;
  }
  return undefined;
};

const executorCrowded = (context: SettlementContext, actor: SettlementActor) => {
  if (!context.actors?.length) return undefined;
  let crowded: number | undefined;
  forEachNearbyTrafficActor(context, actor, 1.25, other => {
    if (other === actor || !other.visible) return false;
    if (DMath.hypot(other.x - actor.x, other.z - actor.z) >= actorSeparation(actor, other) + .5)
      return false;
    crowded = other.uid;
    return true;
  });
  return crowded;
};

/** Building exits and courtyards are where door, stock and traffic decisions interact; defer there. */
const EXECUTOR_BUILDING_DEFER_RANGE = 1.5;
const executorNearBuilding = (context: SettlementContext, actor: SettlementActor) =>
  context.buildings.some(building => buildingEdgeDistance(actor, building) <= EXECUTOR_BUILDING_DEFER_RANGE);

const STORAGE_PHASES = new Set([
  "enterPickup", "enterDelivery", "enterHome", "enterRetire"
]);
const DOOR_PHASES = new Set(["exitLoaded", "exitDelivery", "enterAssigned", "enterRest", "inputReturn"]);
/** Phases that are open-road movement only; every interaction or door phase stays on the fixed tick. */
const EXECUTOR_PHASES = new Set([
  "outbound", "pickup", "deliver", "home", "inputApproach", "outputWalk",
  "pickupStockWalk", "deliveryStockWalk",
  "foresterPickupWalk", "foresterPlantWalk", "foresterReturnWalk",
  "cartToSource", "cartToDestination", "cartReturn"
]);
const CART_PHASES = new Set(["cartToSource", "cartToDestination", "cartReturn"]);
const STOCK_WALK_PHASES = new Set(["inputApproach", "outputWalk", "pickupStockWalk", "deliveryStockWalk",
  "foresterPickupWalk", "foresterReturnWalk"]);

/** Only ordinary visible workers on an open-road leg may skip quiet fixed ticks. */
export const movementExecutionEligible = (actor: SettlementActor) =>
  actor.visible && !actor.mounted && actor.navalOrder === undefined &&
  actor.boatWork === undefined && actor.job !== "Soldier" &&
  actor.job !== "Mount" && actor.job !== "Recruit" && actor.job !== "Scout" &&
  !actor.demolitionReturning &&
  (!CART_PHASES.has(actor.phase) || actor.handcart?.state === "hitched") &&
  (!STOCK_WALK_PHASES.has(actor.phase) || actor.stockContact !== undefined) &&
  EXECUTOR_PHASES.has(actor.phase);

export const movementExecutionWake = (
  context: SettlementContext, actor: SettlementActor
): MovementWakeReason => {
  const plan = actor.workerMovementPlan;
  if (!plan || plan.status === "invalidated") return "invalidated";
  if (!movementExecutionIsCurrent(context, actor, plan.revision)) return "invalidated";
  if (plan.ware !== undefined && plan.ware !== actor.ware) return "cargo";
  if (plan.wareUnits !== undefined && plan.wareUnits !== (actor.wareUnits ?? 1)) return "cargo";
  if (actor.pathIndex >= actor.path.length) return "arrival";
  if (actor.queueTarget || (actor.queueWait ?? 0) > 0) return "traffic";
  if (STORAGE_PHASES.has(actor.phase)) return "storage";
  if (DOOR_PHASES.has(actor.phase)) return "door";
  return "none";
};

/** Experimental opt-in advance: only valid when the wake classifier says the corridor is quiet. */
export const advanceMovementExecution = (
  context: SettlementContext, actor: SettlementActor, dt: number
): MovementExecutionResult => {
  if (!movementExecutionEligible(actor) || movementExecutionWake(context, actor) !== "none") return "handoff";
  const plan = actor.workerMovementPlan!;
  if (executorAdmissionAhead(context, actor) || executorBodyAhead(context, actor) !== undefined ||
    executorCrowded(context, actor) !== undefined || executorNearBuilding(context, actor)) {
    plan.status = "blocked";
    movementExecutionWork.advanceHandoffs++;
    return "handoff";
  }
  const groundSpeed = actorGroundSpeed(context, actor), roadSpeed = actorRoadSpeed(context, actor);
  const speed = groundSpeed * roadSpeed;
  actor.locomotionSpeed = speed;
  actor.action = actor.ware ? "carry" : "walk";
  actor.timer = 0;
  actor.queueKind = undefined;
  tickYieldBudget(actor, dt);
  let remaining = Math.max(0, dt);
  let index = actor.pathIndex;
  let x = actor.x, z = actor.z, yaw = actor.yaw;
  while (remaining > 1e-7 && index < actor.path.length) {
    const target = actor.path[index]!;
    const distance = DMath.hypot(target.x - x, target.z - z);
    const step = Math.min(distance, remaining * groundSpeed * roadSpeed);
    if (distance > 1e-9) {
      const heading = DMath.atan2(target.x - x, target.z - z);
      yaw = turnYawToward(yaw, heading, step / (groundSpeed * roadSpeed) * 6);
      x += (target.x - x) / distance * step;
      z += (target.z - z) / distance * step;
    }
    remaining -= step / (groundSpeed * roadSpeed);
    if (distance <= step + 0.00001) index++;
    else break;
  }
  actor.x = x; actor.z = z; actor.pathIndex = index; actor.yaw = yaw;
  actor.y = sampleSmooth(context.options.world, context.options.world.heights, x, z);
  plan.lastSafePoint = { x, z };
  recordMovementOutcome(actor, "moving");
  updatePersonTraffic(context, actor);
  movementExecutionWork.advanceTicks++;
  if (index >= actor.path.length) {
    completeMovementExecution(context, actor);
    movementExecutionWork.advanceArrivals++;
    return "arrived";
  }
  refreshCorridor(context, actor.uid);
  plan.status = "moving";
  return "moved";
};

const corridorRadius = (actor: SettlementActor) => {
  if (actor.handcart) return .45;
  return actor.mounted ? 1.05 : .3;
};

interface AcquiredRoute {
  path: readonly SettlementPoint[];
  phase: string;
  revision: string;
}
const acquiredRoutes = new WeakMap<SettlementActor, AcquiredRoute>();

/** Acquire the plan and its complete corridor; movement remains on the fixed tick until execution lands. */
export const beginMovementExecution = (
  context: SettlementContext, actor: SettlementActor, path: readonly SettlementPoint[],
  phase = actor.phase
): MovementExecution => {
  const plan = ensureWorkerMovementPlan(context, actor);
  if (!plan) return { ok: false, safePoint: { x: actor.x, z: actor.z } };
  if (plan.pathLength <= 1e-9) {
    movementExecutionWork.admissionNoRoute++;
    return { ok: false, safePoint: plan.lastSafePoint };
  }
  // moveActor calls this every tick. Reuse the current corridor while the same path is under way;
  // re-deriving the coarse cell set every tick was pure overhead.
  const cached = acquiredRoutes.get(actor);
  const reservation = corridorReservation(context, actor.uid);
  if (reservation && cached && cached.path === path && cached.phase === phase &&
    cached.revision === plan.revision && reservation.revision === plan.revision)
    return { ok: true, safePoint: plan.lastSafePoint };
  const acquired = acquireCorridor(context, actor, path, phase, false, corridorRadius(actor), false);
  if (!acquired.ok) {
    acquiredRoutes.delete(actor);
    movementExecutionWork.admissionFailures++;
    if (acquired.reason === "stationary") movementExecutionWork.admissionStationary++;
    else if (acquired.reason === "reservation") movementExecutionWork.admissionReservation++;
    invalidateWorkerMovementPlan(actor);
    return { conflict: acquired.conflict, ok: false, safePoint: plan.lastSafePoint };
  }
  acquiredRoutes.set(actor, { path, phase, revision: plan.revision });
  return { ok: true, safePoint: plan.lastSafePoint };
};

export const movementExecutionIsCurrent = (
  context: SettlementContext, actor: SettlementActor, revision: string
) => {
  const plan = actor.workerMovementPlan;
  if (!plan || plan.status === "invalidated") return false;
  return navigationRevisionKey(context) === revision;
};

/** Abort at the last safe point and release the corridor; the caller must not teleport the actor. */
export const recoverMovementExecution = (context: SettlementContext, actor: SettlementActor) => {
  const safePoint = actor.workerMovementPlan?.lastSafePoint ?? { x: actor.x, z: actor.z };
  releaseCorridor(context, actor.uid);
  invalidateWorkerMovementPlan(actor);
  actor.action = "idle";
  return safePoint;
};

export const completeMovementExecution = (context: SettlementContext, actor: SettlementActor) => {
  releaseCorridor(context, actor.uid);
  actor.workerMovementPlan = undefined;
};
