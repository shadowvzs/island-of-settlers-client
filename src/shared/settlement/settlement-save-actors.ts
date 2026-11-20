import { entriesWithTag } from "@shared/catalog";
import { BUILDING_MATERIAL_ORDER } from "@shared/catalog/balance";

import { cartCapacityFor, HANDCART_OUTPUT } from "../../render-common/logistics/handcart-rules";
import { maximumTalentModifier } from "../progression/talents";
import { ARMORY_STOCK_WARES } from "./armory-orders";
import { isCatapultAmmoKind } from "./catapult-ammo-kinds";
import { catapultWorkerEvacuationError } from "./catapult-worker-evacuation";
import { HUNT_REPLAN_SECONDS } from "./constants";
import { isSavedFisherBoatTrip } from "./fisher-boat-save";
import { isFiniteNumber, isSaveGoods, isSaveInteger, isSaveObject, isSavePoint } from "./save-validation";
import {
  layByClaimKey,
  MAX_SHARED_LAY_BY_WALK
} from "./settlement-carrier-laybys";
import { NO_BUILDING } from "./settlement-home";
import type { SettlementHandcart, TrafficQueueKind } from "./settlement-types";
import { validateNextDelivery } from "./transport-reuse-save";

/** Tree species a forester may plant (the catalog's `foresterPlanted` trees; saved on planting targets). */
const FORESTER_TREE_SPECIES: ReadonlySet<string> = new Set(entriesWithTag("foresterPlanted").map(entry => entry.key));

/** Adventure troops have no home; defenders can still belong to a valid neutral structure. */
const isHomelessFieldActor = (actor: Record<string, unknown>, ids: Set<number>) =>
  actor.home === NO_BUILDING && (actor.job === "Soldier" || actor.phase === "horseMounted") &&
  (actor.building === NO_BUILDING || (actor.job === "Soldier" &&
    ["garrison", "catapultResupply", "militaryField"].includes(actor.phase as string) && ids.has(actor.building as number)));

const TRAFFIC_QUEUE_KINDS: readonly TrafficQueueKind[] = [
  "anchor-return", "court-slot", "doorstep", "proactive", "stationary"
];
const CARRIER_FLEETS: readonly string[] = ["cartless", "handcart"];
const validLease = (value: Record<string, unknown>) => {
  if (value.leaseStartedTick === undefined && value.leaseDeadlineTick === undefined) return true;
  return isSaveInteger(value.leaseStartedTick, 0) && isSaveInteger(value.leaseDeadlineTick, 0) &&
    (value.leaseDeadlineTick as number) >= (value.leaseStartedTick as number);
};
/** A saved bay reservation must belong to this cart's carrier and still be a valid static bay. */
const validLayByClaim = (claim: unknown, actor: number, ids: Set<number>) => {
  if (!isSaveObject(claim) || !ids.has(claim.bay as number) ||
    !isSaveInteger(claim.actor, 0) || claim.actor !== actor ||
    !isSavePoint(claim) || !isFiniteNumber(claim.walk) || claim.walk < 0 ||
    claim.walk > MAX_SHARED_LAY_BY_WALK) return false;
  return validLease(claim);
};
/** A manifest must describe the same cargo/fleet the plan itself captured, when both are present. */
const validMovementManifest = (plan: Record<string, unknown>) => {
  const manifest = plan.manifest;
  if (!isSaveObject(manifest) || !isSaveInteger(manifest.source) ||
    !isSaveInteger(manifest.destination) || typeof manifest.ware !== "string" ||
    !isSaveInteger(manifest.units, 1)) return false;
  if ((manifest.fleet === undefined) !== (manifest.capacity === undefined)) return false;
  if (manifest.fleet !== undefined &&
    (!CARRIER_FLEETS.includes(manifest.fleet as string) || !isSaveInteger(manifest.capacity, 1) ||
      (manifest.units as number) > (manifest.capacity as number))) return false;
  // A cartless carrier has exactly one slot; a multi-unit trade box is the only wider load.
  if (manifest.fleet === "cartless" && manifest.capacity !== 1 &&
    manifest.capacity !== manifest.units) return false;
  if (!validLease(manifest)) return false;
  // A handcart plan describes the whole cart manifest (`units`) while `plan.wareUnits` remains the
  // one unit in the puller's hands. Every other plan compares the two directly.
  const handcartUnits = manifest.fleet === "handcart" && plan.wareUnits === 1;
  return (typeof plan.ware !== "string" || plan.ware === manifest.ware) &&
    (plan.wareUnits === undefined || plan.wareUnits === manifest.units || handcartUnits);
};
const noEconomyFaction = () => false;
const CIVILIAN_EXCLUDED_JOBS: ReadonlySet<unknown> = new Set(["Soldier", "Mount"]);
/** Authored hostile staff are catapult porters; an economy faction's people may hold any civilian job. */
const hostileCivilianJob = (job: unknown, faction: number, economyFaction: (faction: number) => boolean) =>
  job === "Carrier" || (economyFaction(faction) && typeof job === "string" && !CIVILIAN_EXCLUDED_JOBS.has(job));

const validMovementClaims = (claims: unknown) =>
  isSaveObject(claims) && typeof claims.source === "boolean" &&
  typeof claims.destination === "boolean" && validLease(claims);
/** `economyFaction`: whether a computer faction runs an economy, so any civilian job may belong to it. */
export const validateSavedActors = (
  actors: unknown[], ids: Set<number>, actorIds: Set<number>, nowTick = 0,
  economyFaction: (faction: number) => boolean = noEconomyFaction
) => {
  /** Active bay identities in this save: static id plus physical point; each may have one owner. */
  const occupiedBays = new Set<string>();
  for (const actor of actors) {
    if (isSaveObject(actor) && actor.productionOutput !== undefined &&
      (!PRODUCTION_OUTPUTS.includes(actor.productionOutput as string) ||
        !(ids.has(actor.building as number)))) return "Invalid production output";
    if (
      !isSaveObject(actor) ||
      !isSaveInteger(actor.uid, -100000) ||
      actorIds.has(actor.uid) ||
      !isSavePoint(actor) ||
      (actor.productionSeconds !== undefined &&
        (!isFiniteNumber(actor.productionSeconds) || actor.productionSeconds <= 0)) ||
      !isFiniteNumber(actor.y) ||
      !isFiniteNumber(actor.yaw) ||
      typeof actor.visible !== "boolean" ||
      (actor.mounted !== undefined && typeof actor.mounted !== "boolean") ||
      ![
        "idle",
        "walk",
        "carry",
        "work",
        "chop",
        "plant",
        "fish_cast",
        "fish_wait",
        "fish_reel"
      ].includes(actor.action as string) ||
      typeof actor.job !== "string" ||
      typeof actor.phase !== "string" ||
      !Array.isArray(actor.path) ||
      !actor.path.every(isSavePoint) ||
      !isSaveInteger(actor.pathIndex) ||
      actor.pathIndex > actor.path.length ||
      !isFiniteNumber(actor.timer) ||
      !isFiniteNumber(actor.animationTime) ||
      (!(actor.demolitionReturning || actor.phase === "retired" || isHomelessFieldActor(actor, ids)) &&
        (!ids.has(actor.home as number) || !ids.has(actor.building as number))) ||
      !(actor.ware === null || typeof actor.ware === "string")
    )
      return "Invalid worker state or cargo";
    if ((actor.storageArrivalOrder !== undefined &&
      (!Number.isSafeInteger(actor.storageArrivalOrder) || (actor.storageArrivalOrder as number) < 1)) ||
      (actor.storageArrivalBuilding !== undefined && !isSaveInteger(actor.storageArrivalBuilding)))
      return "Invalid storage arrival order";
    if (actor.huntArrow !== undefined) {
      const arrow = actor.huntArrow;
      if (!isSaveObject(arrow) || !isSavePoint(arrow.origin) || !isSavePoint(arrow.target) ||
        !isFiniteNumber(arrow.origin.y) || !isFiniteNumber(arrow.target.y) ||
        !isFiniteNumber(arrow.duration) || arrow.duration <= 0 || arrow.duration > 3)
        return "Invalid hunting arrow";
    }
    if (actor.boatTrip !== undefined && !isSavedFisherBoatTrip(actor.boatTrip)) return "Invalid fisher boat trip";
    if (actor.huntReplan !== undefined && (!isFiniteNumber(actor.huntReplan) || actor.huntReplan > HUNT_REPLAN_SECONDS))
      return "Invalid hunting chase";
    if (actor.hostileCivilianFaction !== undefined &&
      (!isSaveInteger(actor.hostileCivilianFaction) || actor.hostileCivilianFaction < 1 ||
        actor.hostileCivilianFaction > 16 ||
        !hostileCivilianJob(actor.job, actor.hostileCivilianFaction, economyFaction)))
      return "Invalid hostile civilian ownership";
    if (actor.catapultStoneCargo !== undefined && (actor.catapultStoneCargo !== true ||
      !isCatapultAmmoKind(actor.ware) ||
      (actor.wareUnits !== undefined && actor.wareUnits !== 1))) return "Invalid Catapult stone cargo";
    const evacuationError = catapultWorkerEvacuationError(actor);
    if (evacuationError) return evacuationError;
    if (actor.queueKind !== undefined && !TRAFFIC_QUEUE_KINDS.includes(actor.queueKind as TrafficQueueKind))
      return "Invalid traffic queue kind";
    if (actor.shoulderRetryTick !== undefined && !isSaveInteger(actor.shoulderRetryTick, 0))
      return "Invalid shoulder retry tick";
    for (const key of ["target", "preparedTarget"]) {
      const target = actor[key];
      if (isSaveObject(target) && target.treeSpecies !== undefined &&
        (target.kind !== "plant" || !FORESTER_TREE_SPECIES.has(target.treeSpecies as string)))
        return "Invalid planted tree species";
    }
    if (actor.navigationReturnCargo !== undefined && typeof actor.navigationReturnCargo !== "boolean")
      return "Invalid returned cargo ownership";
    if (actor.bridgeWait !== undefined && (!isSaveObject(actor.bridgeWait) ||
      Object.keys(actor.bridgeWait).some(key => key !== "destination") ||
      !isSavePoint(actor.bridgeWait.destination))) return "Invalid bridge wait";
    if (actor.navigationRecovery !== undefined) {
      const recovery = actor.navigationRecovery;
      if (!isSaveObject(recovery) || typeof recovery.task !== "string" ||
        !isFiniteNumber(recovery.elapsed) || recovery.elapsed < 0 || !isSaveInteger(recovery.attempts) ||
        recovery.attempts > 2 || typeof recovery.revision !== "string" ||
        typeof recovery.blocked !== "boolean" || typeof recovery.notified !== "boolean" ||
        (recovery.replanned !== undefined && recovery.replanned !== true))
        return "Invalid navigation recovery state";
      if (recovery.sampler !== undefined) {
        const sample = recovery.sampler;
        if (!isSaveObject(sample) || !isFiniteNumber(sample.remaining) || sample.remaining < 0 ||
          !isFiniteNumber(sample.sampled) || sample.sampled < 0 || sample.sampled >= .5 ||
          typeof sample.pathMatchesCurrent !== "boolean" ||
          !["moving", "arrived", "door-queue", "stock-wait", "yield-wait", "static-blocked",
            "person-blocked", "invalid-route", "interaction"].includes(sample.outcome as string))
          return "Invalid navigation progress sampler";
      }
    }
    if (actor.workerMovementPlan !== undefined) {
      const plan = actor.workerMovementPlan;
      if (!isSaveObject(plan) || typeof plan.phase !== "string" ||
        !isFiniteNumber(plan.pathLength) || plan.pathLength < 0 ||
        typeof plan.revision !== "string" || !isSaveInteger(plan.startedTick) ||
        !isSaveInteger(plan.expectedArriveTick) || !isSavePoint(plan.lastSafePoint) ||
        !isSavePoint(plan.target) ||
        (plan.ware !== undefined && plan.ware !== null && typeof plan.ware !== "string") ||
        (plan.wareUnits !== undefined && (!isSaveInteger(plan.wareUnits) || plan.wareUnits < 1)) ||
        (plan.manifest !== undefined && !validMovementManifest(plan)) ||
        (plan.claims !== undefined && !validMovementClaims(plan.claims)) ||
        !["planned", "moving", "blocked", "arrived", "invalidated"].includes(plan.status as string))
        return "Invalid worker movement plan";
    }
    if (actor.workerHandlingPlan !== undefined) {
      const plan = actor.workerHandlingPlan;
      if (!isSaveObject(plan) || (plan.direction !== "pickup" && plan.direction !== "putdown") ||
        !isSaveInteger(plan.expectedEndTick) || typeof plan.phase !== "string" ||
        !isSaveInteger(plan.startedTick) || (plan.status !== "active" && plan.status !== "released") ||
        typeof plan.ware !== "string")
        return "Invalid worker handling plan";
    }
    if (actor.boatWork !== undefined && (!isFiniteNumber(actor.boatWork) || actor.boatWork < -1 || actor.boatWork > 1))
      return "Invalid boat construction progress";
    if (actor.navalOrder !== undefined && !isSaveInteger(actor.navalOrder, -1)) return "Invalid passenger reservation";
    if (actor.sowingBatch !== undefined && (!Array.isArray(actor.sowingBatch) ||
      actor.sowingBatch.length > 7 || !actor.sowingBatch.every(target =>
        isSaveObject(target) && isSavePoint(target) && isSaveInteger(target.id) && target.kind === "field")))
      return "Invalid farmer sowing batch";
    if (
      actor.delivery &&
      (!isSaveObject(actor.delivery) ||
        !ids.has(actor.delivery.source as number) ||
        !ids.has(actor.delivery.destination as number) ||
        (actor.delivery.sourceInput !== undefined && actor.delivery.sourceInput !== true))
    )
      return "Invalid delivery references";
    if (actor.delivery && isSaveObject(actor.delivery) && !validLease(actor.delivery))
      return "Invalid delivery claim lease";
    if (actor.delivery && isSaveObject(actor.delivery) && actor.delivery.upgrade !== undefined &&
      (actor.delivery.upgrade !== true || actor.job !== "Carrier")) return "Invalid upgrade delivery purpose";
    if (actor.delivery && isSaveObject(actor.delivery) && actor.delivery.sourceInput &&
      (actor.job !== "Carrier" || actor.delivery.upgrade)) return "Invalid input-return delivery purpose";
    if (actor.wareUnits !== undefined && (!isSaveInteger(actor.wareUnits, 1) || !actor.delivery))
      return "Invalid carried box";
    const nextDeliveryProblem = validateNextDelivery(actor, ids, nowTick);
    if (nextDeliveryProblem) return nextDeliveryProblem;
    const cartReason = actor.handcart === undefined ? null : validateHandcart(actor, ids);
    if (cartReason) return cartReason;
    const savedCart = actor.handcart as SettlementHandcart | undefined;
    for (const role of ["source", "destination"] as const) {
      const claim = savedCart?.bays?.[role];
      // An expired claim is stale ownership, not a live double-booking; restore prunes it.
      if (!claim || (claim.leaseDeadlineTick !== undefined && claim.leaseDeadlineTick <= nowTick))
        continue;
      for (const key of [`bay:${claim.bay}`, `point:${layByClaimKey(claim)}`])
        if (occupiedBays.has(key)) return "Duplicate lay-by occupancy";
      occupiedBays.add(`bay:${claim.bay}`);
      occupiedBays.add(`point:${layByClaimKey(claim)}`);
    }
    for (const key of ["consumed", "demolitionCargo"])
      if (actor[key] !== undefined && !isSaveGoods(actor[key])) return "Invalid worker material receipts";
    if (actor.wallRepair !== undefined && !(isSaveObject(actor.wallRepair) &&
      isSaveInteger(actor.wallRepair.building) && isSaveInteger(actor.wallRepair.hp, 1))) return "Invalid wall repair";
    if (isSaveObject(actor.stockContact) && actor.stockContact.presentation !== undefined &&
      actor.stockContact.presentation !== "hanging") return "Invalid stock presentation";
    if (
      actor.wareTransfer &&
      (!isSaveObject(actor.wareTransfer) ||
        !isSavePoint(actor.wareTransfer.target) ||
        (actor.wareTransfer.presentation !== undefined && actor.wareTransfer.presentation !== "hanging") ||
        (actor.wareTransfer.pour !== undefined && typeof actor.wareTransfer.pour !== "boolean") ||
        !isFiniteNumber(actor.wareTransfer.progress) ||
        actor.wareTransfer.progress < 0 ||
        actor.wareTransfer.progress > 1 ||
        !["pickup", "putdown"].includes(actor.wareTransfer.direction as string))
    )
      return "Invalid handoff state";
    actorIds.add(actor.uid);
  }
  return null;
};

const CART_STATES = ["stored", "hitched", "parked"];
/** Outputs a worker may have committed to at the start of a cycle. */
const PRODUCTION_OUTPUTS: readonly string[] = [...ARMORY_STOCK_WARES, HANDCART_OUTPUT, ...BUILDING_MATERIAL_ORDER];

const validCartTrip = (trip: unknown, ids: Set<number>, cargo: number) => {
  if (!isSaveObject(trip) || !ids.has(trip.source as number) || typeof trip.ware !== "string") return false;
  if (trip.destination !== undefined && !ids.has(trip.destination as number)) return false;
  const { delivered, loaded, planned, prepaid } = trip;
  if (!isSaveInteger(delivered) || !isSaveInteger(loaded) || !isSaveInteger(planned) || !isSaveInteger(prepaid)) return false;
  if (trip.capacity !== undefined &&
    (!isSaveInteger(trip.capacity, 1) || (trip.capacity as number) < planned)) return false;
  if (!validLease(trip)) return false;
  // A trip may have been planned with the largest handcart talent.
  return planned <= cartCapacityFor(trip.ware, maximumTalentModifier("handcartCapacity")) && delivered <= loaded &&
    loaded + prepaid <= Math.max(planned, loaded) && cargo <= loaded - delivered;
};

/** A cart belongs to exactly one carrier; its load never exceeds what the ware allows. */
const validateHandcart = (actor: Record<string, unknown>, ids: Set<number>) => {
  const cart = actor.handcart;
  if (!isSaveObject(cart) || actor.job !== "Carrier" || !ids.has(cart.owner as number) ||
    !CART_STATES.includes(cart.state as string) || !isSaveInteger(cart.cargo))
    return "Invalid hand cart";
  if (cart.trip === undefined ? cart.cargo !== 0 : !validCartTrip(cart.trip, ids, cart.cargo))
    return "Invalid hand cart load";
  if (cart.bays !== undefined) {
    if (!isSaveObject(cart.bays)) return "Invalid hand cart lay-by claim";
    const trip = isSaveObject(cart.trip) ? cart.trip : undefined;
    for (const role of ["source", "destination"] as const) {
      const claim = cart.bays[role];
      if (claim === undefined) continue;
      if (!validLayByClaim(claim, actor.uid as number, ids)) return "Invalid hand cart lay-by claim";
      const claimed = claim as Record<string, unknown>;
      const expected = role === "source" ? trip?.source : trip?.destination;
      // A saved claim must still describe this trip's own flag; stale salvage claims are released.
      if (!trip || claimed.bay !== expected) return "Invalid hand cart lay-by claim";
    }
  }
  if (cart.state === "parked" && (!isSavePoint(cart.parked) || !isFiniteNumber(cart.parked.yaw)))
    return "Invalid parked hand cart";
  if (cart.shuttleTarget !== undefined && !ids.has(cart.shuttleTarget as number))
    return "Invalid hand cart recovery target";
  return null;
};
