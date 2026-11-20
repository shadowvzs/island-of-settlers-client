import { DMath } from "../math/deterministic-math";
import { actorIncarnation } from "./actor-incarnation";
import { STORAGE_IDS } from "./production-rules";
import { getBuilding } from "./settlement-building-index";
import { isCadenceSlot } from "./settlement-cadence";
import { createCrowdPointBlocker } from "./settlement-crowd-snapshot";
import { pendingStorageDepartures, requestStorageDeparture } from "./settlement-door-departures";
import {
  chooseEntranceSideSlot, isNearRoad, STORAGE_WAITING_ROAD_CLEARANCE
} from "./settlement-door-lane-clearing";
import { captureStorageTraffic, resumeStorageTraffic } from "./settlement-door-traffic-persistence";
import type { SavedStorageTraffic } from "./settlement-door-traffic-state";
import {
  beginDoorDeparture, beginDoorWait, completeDoorDeparture, completeDoorWait, forgetDoorDeparture,
  forgetDoorWait, handoffDoorWait, observeDoorWaits
} from "./settlement-door-wait-metrics";
import {
  CLEARING_PHASES, clearingStorageArrival, createClearingArrivalFilter, exitPath, isDoorDeparturePhase,
  isInOwnDoorPassage, passageBuilding
} from "./settlement-entrance";
import { findGroundPath, isGroundSegmentClear,isNavigationClear } from "./settlement-navigation";
import { setActorPath } from "./settlement-paths";
import { watchReservation } from "./settlement-reservation-watchdog";
import { clearBlockedStorageAccess } from "./settlement-storage-access-yield";
import { hasStorageDoorLanes, storageDoorFootTraffic, storageDoorLanePoint } from "./settlement-storage-door-lanes";
import {
  actorSeparation, chooseYieldTarget, isTrafficPassThrough, isTrafficSegmentClear
} from "./settlement-traffic";
import { createTransientMap } from "./settlement-transient-state";
import type {
  SettlementActor,
  SettlementBuilding,
  SettlementContext,
  SettlementPoint
} from "./settlement-types";

const clocks = createTransientMap<number>();
const parkingBudgets = createTransientMap<number>();
/** Queue retry clocks are monotonic; animation clocks restart whenever a worker stops walking. */
export const beginStorageTrafficTick = (context: SettlementContext, dt: number) => {
  const now = (clocks.get(context) ?? 0) + dt;
  clocks.set(context, now);
  parkingBudgets.set(context, Math.min(4, (parkingBudgets.get(context) ?? 4) + dt * 4));
  observeDoorWaits(context, now);
  repairDoorPassageOverlaps(context);
};
const arrivalSerial = createTransientMap<number>();
const owners = createTransientMap<Map<number, SettlementActor>>();
const ownerIdentities = new WeakMap<Map<number, SettlementActor>, Map<number, object>>();
const claimStorageTurn = (map: Map<number, SettlementActor>, uid: number, actor: SettlementActor) => {
  let identities = ownerIdentities.get(map);
  if (!identities) { identities = new Map(); ownerIdentities.set(map, identities); }
  map.set(uid, actor);
  identities.set(uid, actorIncarnation(actor));
};
/** A recycled actor shell/UID is a different person and never inherits the former person's turn. */
const currentStorageOwner = (context: SettlementContext, uid: number) => {
  const map = owners.get(context), actor = map?.get(uid);
  if (!map || !actor) return undefined;
  const unregisteredReturn = arrival.has(actor.phase) && !outgoing.has(actor.phase) &&
    (actor.storageArrivalBuilding !== uid || actor.storageArrivalOrder === undefined);
  if (!unregisteredReturn && ownerIdentities.get(map)?.get(uid) === actorIncarnation(actor)) return actor;
  map.delete(uid);
  ownerIdentities.get(map)?.delete(uid);
  return undefined;
};
const arrival = new Set(["home", "retire", "pickup", "deliver"]);
const outgoing = new Set(["pickup", "assigned", "upgradeAssigned", "exitLoaded", "exitDelivery", "militaryLeaving", "militaryTransferLeaving"]);
const entering = new Set(["enterHome", "enterRetire", "enterPickup", "enterDelivery"]);
/** A12: per phase, the storage crossing kinds (bits) whose test requires that phase. */
const CLEARING_CROSSING = 1, LEAVING_CROSSING = 2, ENTERING_CROSSING = 4;
const crossingKinds = new Map<string, number>();
for (const [phases, kind] of [[CLEARING_PHASES, CLEARING_CROSSING], [outgoing, LEAVING_CROSSING],
  [entering, ENTERING_CROSSING]] as const) for (const phase of phases)
  crossingKinds.set(phase, (crossingKinds.get(phase) ?? 0) | kind);
/** Building whose door an outgoing actor leaves: delivery source or destination, military post or home. */
const getExitOwnerUid = (actor: SettlementActor) => {
  if (actor.phase === "exitLoaded") return actor.delivery?.source;
  // A carrier leaving the workshop it delivered to never crosses its home storage's door.
  if (actor.phase === "exitDelivery") return actor.building;
  return actor.phase.startsWith("military") ? actor.building : actor.home;
};
const waiting = new WeakMap<SettlementActor, SettlementPoint>();
/** Queue clock time at which an arrival registered for its storage door turn. */
const registeredAt = new WeakMap<SettlementActor, number>();
const deferred = new WeakMap<SettlementActor, number>();
const deferredRetries = new WeakMap<SettlementActor, number>();
const failedEntries = new WeakMap<SettlementActor, number>();
const parkingPaths = new WeakMap<SettlementActor, SettlementPoint[]>();
const retries = new WeakMap<SettlementActor, number>();
const queueCursor = new WeakMap<SettlementActor, number>();
const staged = new WeakSet<SettlementActor>();
/** Read-only queue state for native-save diagnostics; never registers or advances a turn. */
export const storageDoorQueueSnapshot = (context: SettlementContext, uid: number) => ({
  owner: owners.get(context)?.get(uid)?.uid,
  now: clocks.get(context) ?? 0,
  actors: context.actors.filter(actor => actor.storageArrivalBuilding === uid ||
    (getExitOwnerUid(actor) === uid && outgoing.has(actor.phase))).map(actor => ({
    uid: actor.uid, phase: actor.phase, visible: actor.visible, order: actor.storageArrivalOrder,
    registeredAt: registeredAt.get(actor), deferredUntil: deferred.get(actor),
    staged: staged.has(actor), waiting: waiting.get(actor),
    inPassage: isInOwnDoorPassage(context, actor), clearing: clearingStorageArrival(context, actor)?.uid
  }))
});
const queueIdentities = new WeakMap<SettlementActor, object>();
const clearArrivalCache = (context: SettlementContext, actor: SettlementActor) => {
  if (waiting.has(actor) || parkingPaths.has(actor) || staged.has(actor)) {
    actor.queueTarget = undefined; actor.queueKind = undefined; actor.queueWait = 0;
  }
  waiting.delete(actor); registeredAt.delete(actor); deferred.delete(actor);
  deferredRetries.delete(actor); failedEntries.delete(actor); parkingPaths.delete(actor);
  retries.delete(actor); queueCursor.delete(actor); staged.delete(actor);
  forgetDoorWait(context, actor);
};
/** A queue visit ends when its crew departs or changes destination, even for a reused horse. */
export const leaveStorageArrival = (context: SettlementContext, actor: SettlementActor) => {
  const uid = actor.storageArrivalBuilding, map = owners.get(context);
  if (uid !== undefined && map?.get(uid) === actor) {
    map.delete(uid); ownerIdentities.get(map)?.delete(uid);
  }
  actor.storageArrivalBuilding = undefined;
  actor.storageArrivalOrder = undefined;
  clearArrivalCache(context, actor);
};
const refreshQueueIdentity = (context: SettlementContext, actor: SettlementActor) => {
  const identity = actorIncarnation(actor);
  if (queueIdentities.get(actor) === identity) return;
  queueIdentities.set(actor, identity);
  clearArrivalCache(context, actor);
  forgetDoorDeparture(context, actor);
};
const queueOffsets = [0.65, 1, 1.35, 1.7, 2.05, 2.4, 2.75, 3.1, 3.45, 3.8, 4.15].flatMap(
  (distance) =>
    [1, -1].flatMap((side) =>
      [0.3, 0.7, 1.1, 1.5, 1.9, 2.3].map((back) => ({ distance, side, back }))
    )
);
const destination = (context: SettlementContext, actor: SettlementActor) => {
  let uid = actor.home;
  if (["pickup", "enterPickup"].includes(actor.phase)) uid = actor.delivery?.source ?? -1;
  if (["deliver", "enterDelivery"].includes(actor.phase)) uid = actor.delivery?.destination ?? -1;
  const building = getBuilding(context, uid);
  return building && STORAGE_IDS.has(building.typeId) && building.construction === 1 ? building : undefined;
};
const retryReady = (actor: SettlementActor) => {
  const cooldown = retries.get(actor) ?? 0;
  if (cooldown > 0) {
    retries.set(actor, cooldown - 1);
    return false;
  }
  retries.set(actor, 4);
  return true;
};
const registerArrival = (
  context: SettlementContext,
  actor: SettlementActor,
  building: SettlementBuilding
) => {
  refreshQueueIdentity(context, actor);
  if (actor.storageArrivalBuilding === building.uid && actor.storageArrivalOrder !== undefined) {
    if (!registeredAt.has(actor)) {
      const now = clocks.get(context) ?? 0;
      registeredAt.set(actor, now);
      beginDoorWait(context, actor, building.uid, now);
    }
    return;
  }
  const serial = Math.max(
    arrivalSerial.get(context) ?? 0,
    ...context.actors.map((a) => a.storageArrivalOrder ?? 0)
  );
  actor.storageArrivalOrder = serial + 1;
  actor.storageArrivalBuilding = building.uid;
  arrivalSerial.set(context, serial + 1);
  const now = clocks.get(context) ?? 0;
  registeredAt.set(actor, now);
  beginDoorWait(context, actor, building.uid, now);
};
const waitedFor = (context: SettlementContext, actor: SettlementActor) => {
  const now = clocks.get(context) ?? 0;
  return now - (registeredAt.get(actor) ?? now);
};
/** The door queue manages arrivals this close to the access (or already holding a waiting place). */
const ADMISSION_RANGE = 2.5;
/**
 * Waiting places reach about 4.7 tiles from the access. An arrival farther out keeps its FIFO age
 * but cannot hold the door turn: a led horse 25 tiles out held the HQ door for about 50 s while
 * every carrier waited (owner save 2026-10-20 (5)).
 */
const TURN_RANGE = 6;
const isWithinTurnRange = (actor: SettlementActor, building: SettlementBuilding) =>
  DMath.hypot(actor.x - building.access.x, actor.z - building.access.z) <= TURN_RANGE;
const byArrivalOrder = (a: SettlementActor, b: SettlementActor) => a.storageArrivalOrder! - b.storageArrivalOrder!;
/**
 * A12: `actors.filter(keep).sort(byArrivalOrder).slice(0, limit)` in one pass without sorting every
 * queued arrival: equal orders keep actor order, as in the stable sort. A non-numeric order (never
 * expected) takes the original sort, whose comparator would then be undefined.
 */
export const earliestArrivals = (actors: readonly SettlementActor[], keep: (actor: SettlementActor) => boolean,
  limit: number) => {
  const earliest: SettlementActor[] = [];
  for (const actor of actors) {
    if (!keep(actor)) continue;
    const order = actor.storageArrivalOrder;
    if (typeof order !== "number" || Number.isNaN(order))
      return actors.filter(keep).sort(byArrivalOrder).slice(0, limit);
    let slot = earliest.length;
    while (slot > 0 && earliest[slot - 1]!.storageArrivalOrder! > order) slot--;
    if (slot >= limit) continue;
    earliest.splice(slot, 0, actor);
    if (earliest.length > limit) earliest.pop();
  }
  return earliest;
};
/**
 * A registered, visible arrival in turn range for this storage whose retry deferral has ended. The
 * storage test runs first (a pure conjunction: the order of its terms cannot change the answer).
 */
const isReadyArrival = (context: SettlementContext, candidate: SettlementActor, building: SettlementBuilding) =>
  candidate.storageArrivalBuilding === building.uid &&
  candidate.visible &&
  isWithinTurnRange(candidate, building) &&
  arrival.has(candidate.phase) &&
  candidate.storageArrivalOrder !== undefined &&
  destination(context, candidate)?.uid === building.uid &&
  (deferred.get(candidate) ?? 0) <= (clocks.get(context) ?? 0);
/** Hands the free door turn to the earliest ready arrival (FIFO) that has waited `patience` seconds. */
const takeNextArrivalTurn = (
  context: SettlementContext,
  map: Map<number, SettlementActor>,
  building: SettlementBuilding,
  patience = 0
) => {
  const ready = context.actors.filter((candidate) => isReadyArrival(context, candidate, building));
  // Patience counts for the whole queue: a FIFO head that only just came in range keeps its place.
  if (!ready.some((candidate) => waitedFor(context, candidate) >= patience)) return undefined;
  const owner = earliestArrivals(ready, () => true, 1)[0]!;
  claimStorageTurn(map, building.uid, owner);
  retries.delete(owner);
  return owner;
};
/**
 * The departure that competes with arrivals for the door turn. Storage foot lanes: foot departures
 * walk their own lane and never need the turn, so only the first cart/horse departure competes.
 */
const turnDeparture = (context: SettlementContext, building: SettlementBuilding) => {
  const pending = pendingStorageDepartures(context, building.uid);
  if (!hasStorageDoorLanes(building)) return pending[0];
  return pending.find(request => !storageDoorFootTraffic(request.actor));
};
/**
 * Single-lane doors: old arrivals and hidden departures share the door by elapsed wait, retaining
 * arrival FIFO. Storage foot lanes: foot arrivals stream in their own lane, so a cart departure
 * that waited `ARRIVAL_PATIENCE_SECONDS` takes the next free turn. Matching its wait against the
 * oldest arrival held a cart inside the scaled HQ for 88 s while 250 carriers queued outside.
 */
const takeNextStorageTurn = (context: SettlementContext, map: Map<number, SettlementActor>, building: SettlementBuilding) => {
  const departure = turnDeparture(context, building);
  const departureAge = departure ? (clocks.get(context) ?? 0) - departure.since : 0;
  if (!departure || departureAge < ARRIVAL_PATIENCE_SECONDS) return takeNextArrivalTurn(context, map, building);
  if (!hasStorageDoorLanes(building)) {
    const oldestArrival = earliestArrivals(context.actors,
      candidate => isReadyArrival(context, candidate, building), 1)[0];
    if (oldestArrival && departureAge < waitedFor(context, oldestArrival))
      return takeNextArrivalTurn(context, map, building);
  }
  claimStorageTurn(map, building.uid, departure.actor);
  return departure.actor;
};
const ownersFor = (context: SettlementContext) => {
  let map = owners.get(context);
  if (!map) {
    map = new Map();
    owners.set(context, map);
  }
  return map;
};
/**
 * An entering crew is past the entry once it is this far inside along the door lane. A crowd that
 * pushes it back out onto the road must not end its turn, or a departing crew meets it head-on in
 * the lane (HQ deadlock, owner save 2026-10-20 (5)).
 */
const hasPassedEntry = (actor: SettlementActor, building: SettlementBuilding) => {
  const { access, doorThreshold, workerApproach } = building;
  const dx = doorThreshold.x - access.x, dz = doorThreshold.z - access.z;
  const length = DMath.hypot(dx, dz) || 1;
  const inward = ((actor.x - access.x) * dx + (actor.z - access.z) * dz) / length;
  return inward >= DMath.hypot(workerApproach.x - access.x, workerApproach.z - access.z) + .3;
};
/** The owner is through the entry, no longer bound here, or an arrival that is not ready. */
const hasLeftStorageTurn = (
  context: SettlementContext, owner: SettlementActor, building: SettlementBuilding
) => {
  if (entering.has(owner.phase) && hasPassedEntry(owner, building)) return true;
  // A turn whose arrival owner is not ready (out of range, deferred) passes on.
  if (arrival.has(owner.phase) && !isReadyArrival(context, owner, building)) return true;
  return destination(context, owner)?.uid !== building.uid ||
    (!arrival.has(owner.phase) && !entering.has(owner.phase));
};
/** `mayClear`: the exact prefilter of `createClearingArrivalFilter` (uid and door-lane box). */
const isClearingCrossing = (context: SettlementContext, candidate: SettlementActor, building: SettlementBuilding,
  mayClear: (actor: SettlementActor) => boolean) =>
  mayClear(candidate) && clearingStorageArrival(context, candidate)?.uid === building.uid;
/** `footLanes`: the asking arrival walks a storage foot lane, clear of foot departures in theirs. */
const isLeavingCrossing = (context: SettlementContext, candidate: SettlementActor, building: SettlementBuilding,
  footLanes: boolean) =>
  getExitOwnerUid(candidate) === building.uid &&
  candidate.visible &&
  outgoing.has(candidate.phase) &&
  (!footLanes || !storageDoorFootTraffic(candidate)) &&
  isInOwnDoorPassage(context, candidate);
const isEnteringCrossing = (context: SettlementContext, candidate: SettlementActor, building: SettlementBuilding) =>
  candidate.visible &&
  entering.has(candidate.phase) &&
  destination(context, candidate)?.uid === building.uid &&
  DMath.hypot(candidate.x - building.access.x, candidate.z - building.access.z) <
    DMath.hypot(building.workerApproach.x - building.access.x, building.workerApproach.z - building.access.z) + 0.3;
/**
 * The first clearing arrival, else the first leaving crew, else the first entering crew, in actor
 * order. A10b: one pass instead of three; the tests are pure, so the result is the same. A horse
 * arriving at a storage with foot lanes needs the whole doorway: foot departures cross it as well.
 */
const findStorageCrossing = (context: SettlementContext, building: SettlementBuilding, asking: SettlementActor) => {
  let leaving: SettlementActor | undefined, entered: SettlementActor | undefined;
  const mayClear = createClearingArrivalFilter(context, building.uid);
  const footLanes = hasStorageDoorLanes(building) && storageDoorFootTraffic(asking);
  for (const candidate of context.actors) {
    // A12: each crossing test needs a visible candidate in one of its phases; skip the others exactly.
    if (!candidate.visible) continue;
    const kinds = crossingKinds.get(candidate.phase);
    if (kinds === undefined) continue;
    if (kinds & CLEARING_CROSSING && isClearingCrossing(context, candidate, building, mayClear)) return candidate;
    if (!leaving && kinds & LEAVING_CROSSING && isLeavingCrossing(context, candidate, building, footLanes))
      leaving = candidate;
    if (!entered && kinds & ENTERING_CROSSING && isEnteringCrossing(context, candidate, building)) entered = candidate;
  }
  return leaving ?? entered;
};
const reserveStorageTurn = (
  context: SettlementContext,
  actor: SettlementActor,
  building: SettlementBuilding
) => {
  const map = ownersFor(context);
  let owner = currentStorageOwner(context, building.uid);
  const crossing = findStorageCrossing(context, building, actor);
  if (crossing && owner !== crossing) {
    owner = crossing;
    claimStorageTurn(map, building.uid, crossing);
  }
  const departed = owner && owner !== crossing && hasLeftStorageTurn(context, owner, building);
  const departures = pendingStorageDepartures(context, building.uid);
  const reservedDeparture = owner && departures.some((request) => request.actor === owner);
  if (owner && (!context.actors.includes(owner) || (!owner.visible && !reservedDeparture) || (departed && !reservedDeparture))) {
    map.delete(building.uid);
    owner = undefined;
  }
  owner ??= takeNextStorageTurn(context, map, building);
  if (owner && arrival.has(owner.phase)) watchStorageTurn(context, map, owner, building);
  return owner;
};
const watchStorageTurn = (context: SettlementContext, map: Map<number, SettlementActor>,
  watched: SettlementActor, building: SettlementBuilding) =>
  watchReservation(context, `door:${building.uid}`, watched,
    () => currentStorageOwner(context, building.uid) === watched && arrival.has(watched.phase),
    () => {
      map.delete(building.uid);
      deferred.set(watched, (clocks.get(context) ?? 0) + .5 + (Math.abs(watched.uid) % 4) * .5);
    }, building.access);
const rejoinStorageAccess = (
  context: SettlementContext,
  actor: SettlementActor,
  building: SettlementBuilding
) => {
  if (!waiting.has(actor)) return true;
  if (!retryReady(actor)) return false;
  const entry = storageDoorLanePoint(building, building.access, "in");
  const path = findGroundPath(context, actor, entry, createParkingBlocker(context, actor), undefined, 0.125, 512);
  if (path) {
    waiting.delete(actor);
    parkingPaths.delete(actor);
    failedEntries.delete(actor);
    deferred.delete(actor);
    setActorPath(actor, path, actor.phase);
    return false;
  }
  clearBlockedStorageAccess(context, actor, building);
  // FIFO cannot progress if later reservations surround its owner. Ask only a blocking
  // parked crew to move along a collision-checked edge, retaining both crews' arrival order.
  const terrainRoute = findGroundPath(
    context,
    actor,
    building.access,
    undefined,
    undefined,
    0.125,
    512
  );
  const next = terrainRoute?.find(
    (point) => DMath.hypot(point.x - actor.x, point.z - actor.z) > 0.2
  );
  if (next) {
    const blocker = context.actors.find(
      (other) =>
        other !== actor &&
        other.visible &&
        !isTrafficPassThrough(context, actor, other) &&
        arrival.has(other.phase) &&
        other.storageArrivalBuilding === building.uid &&
        DMath.hypot(other.x - next.x, other.z - next.z) < actorSeparation(actor, other) + 0.12
    );
    if (blocker) {
      const shoulder = chooseYieldTarget(
        context,
        blocker,
        actor,
        next,
        true,
        (point) => DMath.hypot(point.x - next.x, point.z - next.z) > 0.4
      );
      if (shoulder) {
        waiting.set(blocker, shoulder);
        parkingPaths.delete(blocker);
        blocker.queueTarget = shoulder;
        blocker.queueWait = 0;
      }
    }
  }
  const failures = (failedEntries.get(actor) ?? 0) + 1;
  failedEntries.set(actor, failures);
  if (failures >= 3) {
    // Retain original FIFO age, but do not let a physically trapped head block the entire building.
    // A short deferral lets an accessible arrival leave the crowd, then retries this older crew.
    const queued = context.actors.filter(
      (other) =>
        other.visible && arrival.has(other.phase) && other.storageArrivalBuilding === building.uid
    ).length;
    deferred.set(actor, (clocks.get(context) ?? 0) + Math.min(2, Math.max(0.5, queued * 0.1)));
    failedEntries.delete(actor);
    owners.get(context)?.delete(building.uid);
  }
  actor.action = "idle";
  return false;
};
/** Clearance margin of a parked or rejoining crew. */
const PARKING_MARGIN = 0.02;
/** `parkingBlocked` for every sample of one ground search (A10: the crowd is read once). */
const createParkingBlocker = (context: SettlementContext, actor: SettlementActor) =>
  createCrowdPointBlocker(context, actor, PARKING_MARGIN);
const parkingBlocked = (
  context: SettlementContext,
  actor: SettlementActor,
  point: SettlementPoint
) =>
  context.actors.some(
    (other) =>
      other !== actor &&
      other.visible &&
      !isTrafficPassThrough(context, actor, other) &&
      DMath.hypot(other.x - point.x, other.z - point.z) < actorSeparation(actor, other) + PARKING_MARGIN
  );
/** Waiting places keep clear of every road, so queues never stand in through traffic. */
const outsideRoad = (context: SettlementContext, point: SettlementPoint) =>
  !isNearRoad(context, point, STORAGE_WAITING_ROAD_CLEARANCE);
const parkingRoute = (
  context: SettlementContext,
  actor: SettlementActor,
  goal: SettlementPoint
) => {
  if (isTrafficSegmentClear(context, actor, goal, true)) return [goal];
  return findGroundPath(context, actor, goal, createParkingBlocker(context, actor), undefined, 0.125, 512);
};
const walkToWaitingPoint = (
  context: SettlementContext,
  actor: SettlementActor,
  building: SettlementBuilding
) => {
  const held = waiting.get(actor);
  if (held && DMath.hypot(actor.x - held.x, actor.z - held.z) < 0.06) {
    actor.queueTarget = undefined;
    actor.queueWait = 0;
    return false;
  }
  const route = parkingPaths.get(actor);
  if (actor.queueTarget && actor.timer < 1) return true;
  if (route?.length && !actor.queueTarget) {
    actor.queueTarget = route.shift();
    actor.queueWait = 0;
    return true;
  }
  if ((parkingBudgets.get(context) ?? 4) < 1 || !retryReady(actor)) return false;
  parkingBudgets.set(context, (parkingBudgets.get(context) ?? 4) - 1);
  if (held && !parkingBlocked(context, actor, held)) {
    const path = parkingRoute(context, actor, held);
    if (path?.length) {
      parkingPaths.set(actor, path);
      actor.queueTarget = path.shift();
      actor.queueWait = 0;
      return true;
    }
  }
  const dx = building.workerApproach.x - building.access.x;
  const dz = building.workerApproach.z - building.access.z;
  const length = DMath.hypot(dx, dz) || 1;
  const start = queueCursor.get(actor) ?? 0;
  let searches = 0;
  for (let attempt = 0; attempt < 24; attempt++) {
    const index = (start + attempt) % queueOffsets.length;
    queueCursor.set(actor, (index + 1) % queueOffsets.length);
    const { back, distance, side } = queueOffsets[index]!;
    const target = {
      x: building.access.x - (dz / length) * distance * side - (dx / length) * back,
      z: building.access.z + (dx / length) * distance * side - (dz / length) * back
    };
    if (!outsideRoad(context, target)) continue;
    const reserved = context.actors.some(
      (other) =>
        other !== actor &&
        other.visible &&
        !isTrafficPassThrough(context, actor, other) &&
        [other, waiting.get(other), other.queueTarget].some(
          (point) =>
            point &&
            DMath.hypot(point.x - target.x, point.z - target.z) <
              Math.max(0.75, actorSeparation(actor, other) + 0.12)
        )
    );
    if (reserved) continue;
    // Keep pathfinding bounded even when a crowded saved queue has no free shoulder.
    if (++searches > 2) break;
    const path = parkingRoute(context, actor, target);
    if (!path?.length) continue;
    waiting.set(actor, target);
    parkingPaths.set(actor, path);
    actor.queueTarget = path.shift();
    actor.queueWait = 0;
    return true;
  }
  return false;
};
/** A visible arrival queued for this storage whose retry deferral has ended (storage test first). */
const isQueuedArrival = (context: SettlementContext, other: SettlementActor, building: SettlementBuilding) =>
  other.storageArrivalBuilding === building.uid && other.visible && arrival.has(other.phase) &&
  (deferred.get(other) ?? 0) <= (clocks.get(context) ?? 0);
/**
 * FIFO followers staged on the approach line behind the turn owner: eight (2.2 tiles of line) keep the
 * busy HQ fed while departures now share the doorway (scaled fixture).
 */
const STAGED_FOLLOWERS = 8;
/** Keep a short physical FIFO approach buffer while the current crew crosses the hall. */
const stageStorageFollower = (
  context: SettlementContext, actor: SettlementActor, building: SettlementBuilding,
  owner: SettlementActor | undefined
): boolean | undefined => {
  if (!owner || (outgoing.has(owner.phase) && getExitOwnerUid(owner) === building.uid) || (arrival.has(owner.phase) &&
    DMath.hypot(owner.x - building.access.x, owner.z - building.access.z) > .5)) {
    if (staged.delete(actor)) {
      waiting.delete(actor); parkingPaths.delete(actor); actor.queueTarget = undefined;
    }
    return undefined;
  }
  const next = earliestArrivals(context.actors, other => other !== owner &&
    isQueuedArrival(context, other, building), STAGED_FOLLOWERS);
  const rank = next.indexOf(actor);
  if (rank < 0) return undefined;
  const dx = building.access.x - building.workerApproach.x;
  const dz = building.access.z - building.workerApproach.z;
  const length = DMath.hypot(dx, dz) || 1;
  let distance = 0, previous = owner;
  for (const follower of next.slice(0, rank + 1)) {
    distance += Math.max(.28, actorSeparation(previous, follower) + .04);
    previous = follower;
  }
  const target = { x: building.access.x + dx / length * distance,
    z: building.access.z + dz / length * distance };
  if (DMath.hypot(actor.x - target.x, actor.z - target.z) < .06) {
    waiting.set(actor, target); staged.add(actor); actor.queueTarget = undefined; actor.queueWait = 0;
    parkingPaths.delete(actor); return false;
  }
  const held = waiting.get(actor);
  if (staged.has(actor) && held && DMath.hypot(held.x - target.x, held.z - target.z) < .03) {
    return walkToWaitingPoint(context, actor, building) || stepOffEntranceCorridor(context, actor, building);
  }
  const direct = isTrafficSegmentClear(context, actor, target, true);
  if (!direct && !retryReady(actor)) return undefined;
  const path = direct ? [target] : parkingRoute(context, actor, target);
  if (!path?.length) return undefined;
  staged.add(actor); waiting.set(actor, target); parkingPaths.set(actor, path);
  actor.queueTarget = path.shift(); actor.queueWait = 0;
  return true;
};

/** The next ready arrival can follow an entering crew without waiting for its whole hall traversal. */
const followStorageEntry = (
  context: SettlementContext,
  actor: SettlementActor,
  building: SettlementBuilding,
  owner: SettlementActor | undefined
) => {
  if (
    !owner ||
    !entering.has(owner.phase) ||
    DMath.hypot(actor.x - building.access.x, actor.z - building.access.z) > ADMISSION_RANGE ||
    DMath.hypot(owner.x - building.access.x, owner.z - building.access.z) <
      actorSeparation(actor, owner) + 0.05
  )
    return false;
  const next = earliestArrivals(context.actors, other => isQueuedArrival(context, other, building), 1)[0];
  if (next !== actor) return false;
  if (waiting.has(actor)) {
    const path = isTrafficSegmentClear(context, actor, building.access, true) ? [building.access]
      : findGroundPath(context, actor, building.access, createParkingBlocker(context, actor), undefined, 0.125, 512);
    if (!path) return false;
    waiting.delete(actor);
    parkingPaths.delete(actor);
    retries.delete(actor);
    setActorPath(actor, path, actor.phase);
  }
  return true;
};
/** A retry-round deferral must end early once departing crews leave a clear route to the door. */
const reopenClearArrival = (
  context: SettlementContext,
  actor: SettlementActor,
  building: SettlementBuilding
) => {
  const now = clocks.get(context) ?? 0;
  if ((deferred.get(actor) ?? 0) <= now || (deferredRetries.get(actor) ?? 0) > now) return;
  deferredRetries.set(actor, now + 0.5);
  if (!isTrafficSegmentClear(context, actor, building.access, true)) return;
  deferred.delete(actor);
  deferredRetries.delete(actor);
  failedEntries.delete(actor);
  retries.delete(actor);
};
/** A parked arrival stands within this of its held waiting place (the parking walk's arrival test). */
const PARKED_DISTANCE = 0.06;
/**
 * SIM-CADENCE: an arrival parked on its waiting place while another crew holds the door turn
 * re-checks its turn on its quarter-second slot only. The turn owner, a free turn, the staged FIFO
 * buffer and anyone still walking to a place keep the every-tick check, so the door handover and
 * the follow-up behind an entering crew stay as quick as before.
 */
const waitsForQueueCadence = (context: SettlementContext, actor: SettlementActor, building: SettlementBuilding) => {
  if (isCadenceSlot(context, actor.uid)) return false;
  const owner = owners.get(context)?.get(building.uid);
  if (!owner || owner === actor || staged.has(actor) || actor.queueTarget) return false;
  if (parkingPaths.get(actor)?.length) return false;
  const held = waiting.get(actor);
  return !!held && DMath.hypot(actor.x - held.x, actor.z - held.z) < PARKED_DISTANCE;
};
/** Admit one FIFO storage arrival, retaining a visible outgoing crew's right to clear the passage. */
export const admitStorageArrival = (context: SettlementContext, actor: SettlementActor) => {
  if (!arrival.has(actor.phase) || !actor.visible) return true;
  const building = destination(context, actor);
  if (actor.storageArrivalBuilding !== undefined && actor.storageArrivalBuilding !== building?.uid)
    leaveStorageArrival(context, actor);
  if (!building) return true;
  if (
    DMath.hypot(actor.x - building.access.x, actor.z - building.access.z) > ADMISSION_RANGE &&
    !waiting.has(actor)
  )
    return true;
  registerArrival(context, actor, building);
  // Finish an already-started outward hall leg before requesting a place outside. This also
  // restores saved traffic where an outbound horse is waiting directly behind the arrival.
  if (clearingStorageArrival(context, actor)?.uid === building.uid) return true;
  reopenClearArrival(context, actor, building);
  if (waitsForQueueCadence(context, actor, building)) return false;
  const owner = reserveStorageTurn(context, actor, building);
  // Save/load preserves a waiting crew's actual position; reconstruct only the transient cache.
  if (
    !actor.queueTarget &&
    (actor.queueWait ?? 0) > 0 &&
    !waiting.has(actor) &&
    outsideRoad(context, actor)
  )
    waiting.set(actor, { x: actor.x, z: actor.z });
  if (owner === actor) {
    const admitted = rejoinStorageAccess(context, actor, building);
    if (admitted) completeDoorWait(context, actor, clocks.get(context) ?? 0);
    return admitted;
  }
  if (followStorageEntry(context, actor, building, owner)) {
    completeDoorWait(context, actor, clocks.get(context) ?? 0);
    return true;
  }
  const staging = stageStorageFollower(context, actor, building, owner);
  if (staging !== undefined) return staging;
  return walkToWaitingPoint(context, actor, building) || stepOffEntranceCorridor(context, actor, building);
};
/**
 * A queued arrival left on the entrance corridor (no free waiting point, e.g. a led horse that just
 * unloaded at the access) steps to a side slot, so the turn owner and departing crews can pass.
 */
const stepOffEntranceCorridor = (
  context: SettlementContext, actor: SettlementActor, building: SettlementBuilding
) => {
  if (actor.queueTarget) return false;
  const aside = chooseEntranceSideSlot(context, actor, building);
  if (!aside) return false;
  // The side slot becomes its waiting place; a saved place on the corridor must not pull it back.
  waiting.set(actor, aside);
  parkingPaths.delete(actor);
  actor.queueTarget = aside;
  actor.queueWait = 0;
  return true;
};
export const ownsStorageArrival = (context: SettlementContext, actor: SettlementActor) => {
  const building = destination(context, actor);
  return !!building && currentStorageOwner(context, building.uid) === actor;
};
/**
 * Departures flow back to back, but an arrival that has waited this long takes the next free turn:
 * a long recruited dispatch burst must not starve the queue outside (TRAFFIC-01).
 */
const ARRIVAL_PATIENCE_SECONDS = 4;
const takeArrivalTurnAfterExit = (context: SettlementContext, uid: number) => {
  const building = getBuilding(context, uid);
  return !!building && !!takeNextArrivalTurn(context, ownersFor(context), building, ARRIVAL_PATIENCE_SECONDS);
};
/**
 * A cart or horse holding the turn needs the whole doorway: it is crossing, inside waiting for its
 * own exit, or arriving/entering here (it would meet a foot departure head-on in the doorway).
 */
const holdsDoorForLargeCrew = (context: SettlementContext, owner: SettlementActor | undefined,
  actor: SettlementActor, building: SettlementBuilding) => {
  if (!owner || owner === actor || storageDoorFootTraffic(owner)) return false;
  if (!owner.visible) return pendingStorageDepartures(context, building.uid).some(request => request.actor === owner);
  if (isInOwnDoorPassage(context, owner)) return true;
  return destination(context, owner)?.uid === building.uid && (arrival.has(owner.phase) || entering.has(owner.phase));
};
/**
 * Storage foot lanes: departures leave one by one in pending order behind their own leaf. Only
 * pending foot departures count: a cart waiting for the turn at the head of the list held every
 * foot carrier behind it inside (scaled HQ, 88 s).
 */
const canBeginFootLaneExit = (context: SettlementContext, actor: SettlementActor, building: SettlementBuilding,
  owner: SettlementActor | undefined) => {
  if (holdsDoorForLargeCrew(context, owner, actor, building)) return false;
  // A stale cart/horse turn passes to an arrival that has waited long enough.
  if (owner && owner.visible && !storageDoorFootTraffic(owner)) takeArrivalTurnAfterExit(context, building.uid);
  if (actor.visible) return true;
  const first = pendingStorageDepartures(context, building.uid).find(request => storageDoorFootTraffic(request.actor));
  return !first || first.actor === actor;
};
/** A reserved incoming turn cannot be continually displaced by freshly recruited departures. */
export const canBeginStorageExit = (context: SettlementContext, actor: SettlementActor) => {
  if (!outgoing.has(actor.phase)) {
    forgetDoorDeparture(context, actor);
    return true;
  }
  if (!actor.visible) {
    leaveStorageArrival(context, actor);
  }
  const uid = getExitOwnerUid(actor);
  if (uid === undefined) {
    forgetDoorDeparture(context, actor);
    return true;
  }
  const now = clocks.get(context) ?? 0;
  if (!actor.visible) {
    const request = requestStorageDeparture(context, uid, actor, now);
    if (request.created) beginDoorDeparture(context, actor, uid, request.since);
  } else forgetDoorDeparture(context, actor);
  const owner = currentStorageOwner(context, uid);
  const building = getBuilding(context, uid);
  if (building && hasStorageDoorLanes(building) && storageDoorFootTraffic(actor)) {
    const allowed = canBeginFootLaneExit(context, actor, building, owner);
    if (allowed && !actor.visible) completeDoorDeparture(context, actor, now);
    return allowed;
  }
  let allowed = true;
  if (owner && owner !== actor && context.actors.includes(owner)) {
    if (!owner.visible)
      allowed = !pendingStorageDepartures(context, uid).some((request) => request.actor === owner);
    else if (!context.buildings.some((building) => building.uid === uid))
      allowed = true;
    else if (outgoing.has(owner.phase) && getExitOwnerUid(owner) === uid)
      allowed = !isInOwnDoorPassage(context, owner) && !takeArrivalTurnAfterExit(context, uid);
    else
      allowed = destination(context, owner)?.uid !== uid ||
        (!arrival.has(owner.phase) && !entering.has(owner.phase));
  }
  if (allowed && !actor.visible) completeDoorDeparture(context, actor, now);
  return allowed;
};

export const isHoldingStorageTurn = (context: SettlementContext, actor: SettlementActor) => {
  const building = destination(context, actor);
  return !!building && waiting.has(actor) && currentStorageOwner(context, building.uid) !== actor;
};

const capacityCaches = createTransientMap<Map<number, { capacity: number; revision: string }>>();
/** Reserve only as many destination jobs as its terrain-checked shoulder can physically hold. */
export const canReserveStorageDelivery = (
  context: SettlementContext,
  building: SettlementBuilding
) => {
  if (!STORAGE_IDS.has(building.typeId) || building.construction < 1) return true;
  let cache = capacityCaches.get(context);
  if (!cache) {
    cache = new Map();
    capacityCaches.set(context, cache);
  }
  const revision = `${context.options.roads.revision ?? 0}:${context.options.world.buildRevision ?? 0}`;
  let entry = cache.get(building.uid);
  if (!entry || entry.revision !== revision) {
    const dx = building.workerApproach.x - building.access.x;
    const dz = building.workerApproach.z - building.access.z;
    const length = DMath.hypot(dx, dz) || 1;
    const positions: SettlementPoint[] = [];
    for (const { back, distance, side } of queueOffsets) {
      const point = {
        x: building.access.x - (dz / length) * distance * side - (dx / length) * back,
        z: building.access.z + (dx / length) * distance * side - (dz / length) * back
      };
      if (
        !outsideRoad(context, point) ||
        !isNavigationClear(context, point) ||
        positions.some((other) => DMath.hypot(other.x - point.x, other.z - point.z) < 0.75) ||
        !isGroundSegmentClear(context, building.access, point)
      )
        continue;
      positions.push(point);
    }
    entry = { revision, capacity: Math.max(1, positions.length) };
    cache.set(building.uid, entry);
  }
  const committed = context.actors.filter(
    (actor) => actor.delivery?.destination === building.uid
  ).length;
  return committed < entry.capacity;
};

/** The FIFO owns its parking/rejoin path, including recovery of a temporarily trapped owner. */
export const isManagedStorageArrival = (context: SettlementContext, actor: SettlementActor) => {
  const building = destination(context, actor);
  return !!building && actor.storageArrivalBuilding === building.uid &&
    (arrival.has(actor.phase) || entering.has(actor.phase));
};

/** A led animal arrives before its escort: transfer the same FIFO turn without duplicating it. */
export const handoffStorageArrival = (
  context: SettlementContext, escort: SettlementActor, animal: SettlementActor,
  building: SettlementBuilding
) => {
  if (escort.storageArrivalBuilding === building.uid) {
    animal.storageArrivalBuilding = building.uid;
    animal.storageArrivalOrder = escort.storageArrivalOrder;
  }
  escort.storageArrivalBuilding = undefined;
  escort.storageArrivalOrder = undefined;
  waiting.delete(escort); parkingPaths.delete(escort); deferred.delete(escort);
  deferredRetries.delete(escort); failedEntries.delete(escort); retries.delete(escort);
  handoffDoorWait(context, escort, animal);
  const held = owners.get(context);
  if (held && currentStorageOwner(context, building.uid) === escort)
    claimStorageTurn(held, building.uid, animal);
};

const enteringOuterPhase: Readonly<Record<string, string>> = {
  enterAssigned: "assigned", enterDelivery: "deliver", enterHome: "home",
  enterPickup: "pickup", enterRest: "rest", enterRetire: "retire"
};
/** A free standing point outside the doorway lane, preferring the storage access and nearby road. */
const doorRecoveryPoint = (
  context: SettlementContext, building: SettlementBuilding, actor: SettlementActor
) => {
  const candidates: SettlementPoint[] = [{ ...building.access }];
  for (let radius = .3; radius <= 8; radius += .3) {
    const count = Math.max(8, Math.ceil(2 * Math.PI * radius / .3));
    for (let index = 0; index < count; index++) {
      const angle = index / count * Math.PI * 2;
      candidates.push({ x: building.access.x + DMath.cos(angle) * radius,
        z: building.access.z + DMath.sin(angle) * radius });
    }
  }
  for (const point of candidates) {
    const candidate = { ...actor, x: point.x, z: point.z };
    if (isInOwnDoorPassage(context, candidate) || !isNavigationClear(context, point)) continue;
    if (context.actors.some(other => other !== actor && other.visible &&
      DMath.hypot(other.x - point.x, other.z - point.z) < .3)) continue;
    return point;
  }
  return { ...building.access };
};
const recoverEnteringCrew = (
  context: SettlementContext, building: SettlementBuilding, actor: SettlementActor
) => {
  const point = doorRecoveryPoint(context, building, actor);
  actor.visible = true;
  actor.x = point.x; actor.z = point.z;
  actor.phase = enteringOuterPhase[actor.phase] ?? actor.phase;
  actor.path = []; actor.pathIndex = 0;
  actor.queueTarget = undefined; actor.queueWait = 0; actor.action = "idle"; actor.timer = 0;
  leaveStorageArrival(context, actor);
};
const recoverExitingCrew = (
  context: SettlementContext, building: SettlementBuilding, actor: SettlementActor
) => {
  // Put the extra loaded/returning crew back inside and let the normal departure turn reveal it.
  actor.x = building.doorThreshold.x; actor.z = building.doorThreshold.z;
  actor.visible = false;
  actor.pathIndex = 0;
  if (!actor.path.length) actor.path = exitPath(building);
  actor.queueTarget = undefined; actor.queueWait = 0; actor.action = "idle"; actor.timer = 0;
  leaveStorageArrival(context, actor);
};
const isLoadedDeparture = (actor: SettlementActor) =>
  actor.phase === "exitLoaded" || actor.phase === "exitDelivery";
/** Storage foot lanes: every departure already walks clear of every arrival across the door axis. */
const keepsSeparateDoorLanes = (
  building: SettlementBuilding, actors: SettlementActor[], departures: SettlementActor[]
) => {
  if (!hasStorageDoorLanes(building) || !actors.every(storageDoorFootTraffic)) return false;
  const across = { x: Math.round(DMath.cos(building.rotation * Math.PI / 2)),
    z: Math.round(DMath.sin(building.rotation * Math.PI / 2)) };
  return departures.every(out => actors.every(other => other === out || departures.includes(other) ||
    Math.abs((out.x - other.x) * across.x - (out.z - other.z) * across.z) >= actorSeparation(out, other) + .02));
};
/**
 * Load-time recovery for a doorway snapshot containing opposing crews. One crew (prefer a loaded
 * departure) remains visible; extra departures wait inside and extra arrivals step back outside.
 * This conserves cargo and task identity and lets the normal FIFO/door rules untangle the rest.
 * A worker, soldier or empty carrier walking out behind a loaded departure is a departure too:
 * treated as an arrival, it lost its whole journey at the doorstep (perf lane, HQ doorway).
 */
export const repairDoorPassageOverlaps = (context: SettlementContext) => {
  const groups = new Map<number, SettlementActor[]>();
  for (const actor of context.actors) {
    if (!actor.visible) continue;
    const uid = passageBuilding(actor);
    if (uid === undefined) continue;
    const building = getBuilding(context, uid);
    if (!building || !building.hasDoor || building.construction < 1 || !isInOwnDoorPassage(context, actor))
      continue;
    const group = groups.get(uid);
    if (group) group.push(actor); else groups.set(uid, [actor]);
  }
  for (const [uid, actors] of groups) {
    const departures = actors.filter(actor => isDoorDeparturePhase(actor.phase));
    const loaded = departures.filter(isLoadedDeparture);
    // Multiple entering followers are intentional; only opposing directions jam the single lane.
    if (actors.length < 2 || !loaded.length || departures.length === actors.length) continue;
    const building = getBuilding(context, uid);
    if (!building || keepsSeparateDoorLanes(building, actors, departures)) continue;
    const keep = loaded.sort((a, b) =>
      (b.pathIndex - a.pathIndex) || (a.storageArrivalOrder ?? Infinity) -
        (b.storageArrivalOrder ?? Infinity) || a.uid - b.uid)[0]!;
    for (const actor of actors) {
      if (actor === keep) continue;
      if (departures.includes(actor)) recoverExitingCrew(context, building, actor);
      else recoverEnteringCrew(context, building, actor);
    }
  }
};

const persistenceCaches = { clocks, parkingBudgets, arrivalSerial, owners, ownerIdentities, queueIdentities,
  waiting, parkingPaths, staged, watchStorageTurn,
  numericQueueCaches: { registeredAt, deferred, deferredRetries, failedEntries, retries, queueCursor } };
export const saveStorageTraffic = (context: SettlementContext) => captureStorageTraffic(context, persistenceCaches);
export const restoreStorageTraffic = (context: SettlementContext, saved?: SavedStorageTraffic) =>
  resumeStorageTraffic(context, persistenceCaches, saved);
