import { TICK_SECONDS } from "../../../../island-of-settlers-shared/src/time/constants";
import { DMath } from "../math/deterministic-math";
import { navigationRevisionKey } from "./settlement-revision-key";
import type {
  SettlementActor,
  SettlementContext,
  SettlementPoint,
  WorkerMovementClaims,
  WorkerMovementManifest,
  WorkerMovementPlan
} from "./settlement-types";

/** Paths are replaced, not mutated, so their length is stable per array object. */
const pathLengths = new WeakMap<readonly SettlementPoint[], number>();
const pathLength = (path: readonly SettlementPoint[]) => {
  const cached = pathLengths.get(path);
  if (cached !== undefined) return cached;
  let length = 0;
  let previous: SettlementPoint | undefined;
  for (const point of path) {
    if (previous) length += DMath.hypot(point.x - previous.x, point.z - previous.z);
    previous = point;
  }
  pathLengths.set(path, length);
  return length;
};

const deliveryManifest = (actor: SettlementActor): WorkerMovementManifest | undefined => {
  const trip = actor.handcart?.trip;
  if (trip) {
    // A cart returning or salvaging without a receiver has no departure manifest to describe.
    if (trip.destination === undefined) return undefined;
    return {
      source: trip.source,
      destination: trip.destination,
      ware: trip.ware,
      units: trip.planned,
      fleet: "handcart",
      capacity: trip.capacity ?? trip.planned
    };
  }
  const delivery = actor.delivery;
  if (!delivery) return undefined;
  const units = actor.wareUnits ?? 1;
  return {
    source: delivery.source,
    destination: delivery.destination,
    ware: delivery.ware,
    units,
    fleet: "cartless",
    // Trade/handover boxes are one visible carrier load even when the box holds several units.
    capacity: Math.max(1, units)
  };
};

/**
 * The destination is claimed when the delivery reserves incoming capacity at assignment. The
 * source is claimed only once the carrier holds the ware (pickup/grip, or an inside-storage load);
 * stock merely reserved for a later pickup is not a source claim.
 */
const deliveryClaims = (
  actor: SettlementActor, manifest: WorkerMovementManifest
): WorkerMovementClaims => {
  const trip = actor.handcart?.trip;
  const lease = trip ?? actor.delivery;
  const leaseSnapshot = lease?.leaseStartedTick !== undefined &&
    lease.leaseDeadlineTick !== undefined
    ? { leaseStartedTick: lease.leaseStartedTick, leaseDeadlineTick: lease.leaseDeadlineTick }
    : {};
  return {
    source: trip ? trip.loaded > 0 : actor.ware === manifest.ware,
    destination: true,
    ...leaseSnapshot
  };
};

const isSameMovement = (
  current: WorkerMovementPlan | undefined,
  actor: SettlementActor,
  revision: string,
  length: number,
  target: SettlementPoint
): current is WorkerMovementPlan => {
  if (!current || current.status === "invalidated") return false;
  return current.phase === actor.phase && current.revision === revision &&
    current.pathLength === length && current.target.x === target.x &&
    current.target.z === target.z;
};

/** Old saves adopt cargo and delivery fields that were not recorded when the plan was made. */
const adoptMovementFields = (plan: WorkerMovementPlan, actor: SettlementActor) => {
  // Saves made before cargo ownership was recorded adopt the current hands on load.
  if (plan.ware === undefined) plan.ware = actor.ware;
  if (plan.wareUnits === undefined) plan.wareUnits = actor.wareUnits ?? 1;
  // Plans saved before manifests were recorded adopt the active delivery on the next movement.
  // A plan that already has a manifest still refreshes it when the delivery or claim state changes.
  const manifest = deliveryManifest(actor);
  if (!manifest) { plan.manifest = undefined; plan.claims = undefined; return; }
  if (!plan.manifest || plan.manifest.source !== manifest.source ||
    plan.manifest.destination !== manifest.destination || plan.manifest.ware !== manifest.ware ||
    plan.manifest.units !== manifest.units) plan.manifest = manifest;
  plan.claims = deliveryClaims(actor, plan.manifest);
};

/** Record a deterministic plan beside the existing path; movement still runs through moveActor. */
export const ensureWorkerMovementPlan = (context: SettlementContext, actor: SettlementActor) => {
  const target = actor.path.at(-1);
  if (!target) { actor.workerMovementPlan = undefined; return undefined; }
  const length = pathLength(actor.path);
  const currentRevision = navigationRevisionKey(context);
  const current = actor.workerMovementPlan;
  if (isSameMovement(current, actor, currentRevision, length, target)) {
    adoptMovementFields(current, actor);
    return current;
  }
  const speed = actor.locomotionSpeed ?? .9;
  const startedTick = context.clock?.tick() ?? 0;
  const manifest = deliveryManifest(actor);
  const plan: WorkerMovementPlan = {
    phase: actor.phase,
    pathLength: length,
    revision: currentRevision,
    startedTick,
    expectedArriveTick: startedTick + Math.ceil(length / speed / TICK_SECONDS),
    lastSafePoint: { x: actor.x, z: actor.z },
    target: { x: target.x, z: target.z },
    status: "planned",
    ware: actor.ware,
    wareUnits: actor.wareUnits ?? 1,
    ...(manifest ? { manifest, claims: deliveryClaims(actor, manifest) } : {})
  };
  actor.workerMovementPlan = plan;
  return plan;
};

export const markWorkerMovement = (
  actor: SettlementActor, status: WorkerMovementPlan["status"], safePoint?: SettlementPoint
) => {
  const plan = actor.workerMovementPlan;
  if (!plan) return;
  plan.status = status;
  if (safePoint) plan.lastSafePoint = { x: safePoint.x, z: safePoint.z };
  if (status === "arrived") actor.workerMovementPlan = undefined;
};

export const invalidateWorkerMovementPlan = (actor: SettlementActor) => {
  if (actor.workerMovementPlan) actor.workerMovementPlan.status = "invalidated";
};

/** One visible handling unit takes one second at the current fixed tick. */
export const beginWorkerHandling = (
  context: SettlementContext, actor: SettlementActor, direction: "pickup" | "putdown", ware: string
) => {
  const startedTick = context.clock?.tick() ?? 0;
  actor.workerHandlingPlan = {
    direction,
    expectedEndTick: startedTick + 20,
    phase: actor.phase,
    startedTick,
    status: "active",
    ware
  };
};

export const releaseWorkerHandling = (actor: SettlementActor) => {
  if (actor.workerHandlingPlan) actor.workerHandlingPlan.status = "released";
};
