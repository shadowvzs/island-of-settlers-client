import { DMath } from "../math/deterministic-math";
import { isCatapultAmmoStock } from "./catapult-ammo-kinds";
import { countGoods } from "./production-rules";
import { getBuilding } from "./settlement-building-index";
import { isInOwnerCorridor, releaseCourtSlot, stepOutOfCourt, waitAtCourtSlot } from "./settlement-court-slots";
import { setActorPath } from "./settlement-paths";
import { reservationTime, restoreReservationTime, restoreReservationWatch, type SavedReservationWatch, saveReservationWatch, watchReservation } from "./settlement-reservation-watchdog";
import { stockContact } from "./settlement-stock-transfers";
import { chooseYieldTarget, setQueueTarget } from "./settlement-traffic";
import { createTransientMap } from "./settlement-transient-state";
import type { SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";
import { stockErrandPath } from "./settlement-worker-stock-paths";

const cooldowns = new WeakMap<SettlementActor, number>();
const owners = createTransientMap<Map<number, SettlementActor>>();
const entering = new Set(["inputApproach", "outputWalk", "deliveryStockWalk", "pickupStockWalk"]);
const active = new Set([...entering, "inputPickup", "inputReturn", "outputPutdown", "pickupTransfer",
  "deliveryTransfer", "carrierLoadedBlocked", "carrierDeliveryBlocked", "carrierPickupBlocked", "home",
  "returnBlockedCarrier", "deliver", "returnWork", "enterRest", "workerRestWait"]);
const porterPhase = (building: SettlementBuilding, actor: SettlementActor) =>
  building.catapultSupply?.porter?.actor === actor.uid ? building.catapultSupply.porter.phase : undefined;
const isCourtEntering = (building: SettlementBuilding, actor: SettlementActor) =>
  entering.has(actor.phase) || porterPhase(building, actor) === "outbound";
const isCourtActive = (building: SettlementBuilding, actor: SettlementActor) => {
  const phase = porterPhase(building, actor);
  return active.has(actor.phase) || phase === "outbound" || phase === "pickup" || phase === "inbound";
};

const COURT_MARGIN = .15;
const isInsideCourt = (building: SettlementBuilding, point: SettlementPoint) =>
  Math.abs(point.x - building.x) <= building.width / 2 && Math.abs(point.z - building.z) <= building.depth / 2;
const isNearCourt = (building: SettlementBuilding, point: SettlementPoint) =>
  Math.abs(point.x - building.x) <= building.width / 2 + COURT_MARGIN &&
  Math.abs(point.z - building.z) <= building.depth / 2 + COURT_MARGIN;
/**
 * An owner keeps the court only while it works there or is still entering it. A unit frozen by a
 * failed route (navigation hold) cannot use the court, so it must not keep everyone else out.
 */
const isValidCourtOwner = (building: SettlementBuilding, owner: SettlementActor) =>
  owner.stockBuilding === building.uid && isCourtActive(building, owner) && !owner.navigationRecovery?.blocked &&
  (isCourtEntering(building, owner) || (owner.visible && isInsideCourt(building, owner)));
const canClaimCourt = (context: SettlementContext, actor: SettlementActor) =>
  !actor.navigationRecovery?.blocked && (cooldowns.get(actor) ?? 0) <= reservationTime(context);
/**
 * Fair turns (TRAFFIC-01): a crew re-claiming its own court for every input fetch kept a queued
 * carrier waiting about 25 s. A waiter queued this long takes the next free turn instead.
 */
const FAIR_TURN_SECONDS = 4;
interface QueuedEntry { building: number; phase: string; since: number }
const queuedSince = new WeakMap<SettlementActor, QueuedEntry>();
const markQueued = (context: SettlementContext, actor: SettlementActor, building: SettlementBuilding) => {
  const queued = queuedSince.get(actor);
  if (queued?.building === building.uid && queued.phase === actor.phase) return;
  queuedSince.set(actor, { building: building.uid, phase: actor.phase, since: reservationTime(context) });
};
const queuedFor = (context: SettlementContext, actor: SettlementActor, building: SettlementBuilding) => {
  const queued = queuedSince.get(actor);
  if (!queued || queued.building !== building.uid || queued.phase !== actor.phase) return -1;
  return reservationTime(context) - queued.since;
};
/**
 * The visible entrant that has queued longest for this court, once past the fair-turn bound and
 * longer than the claimant itself has queued.
 */
const longestStarvedWaiter = (context: SettlementContext, claimant: SettlementActor, building: SettlementBuilding) => {
  let chosen: SettlementActor | undefined;
  let longest = Math.max(FAIR_TURN_SECONDS, queuedFor(context, claimant, building));
  for (const other of context.actors) {
    if (other === claimant || !other.visible || other.stockBuilding !== building.uid || !isCourtEntering(building, other) ||
      !canClaimCourt(context, other)) continue;
    const waited = queuedFor(context, other, building);
    if (waited < longest) continue;
    longest = waited;
    chosen = other;
  }
  return chosen;
};
/**
 * A building's own crew keeps its court across back-to-back errands (each input fetch). When it starts
 * the next errand from indoors, the longest starved waiter takes the turn and the crew waits indoors.
 */
const yieldsTurnToStarvedWaiter = (context: SettlementContext, actor: SettlementActor,
  building: SettlementBuilding) => !actor.visible && longestStarvedWaiter(context, actor, building);
/** Reserve the narrow owned stock court for one physical handoff/exit at a time; doors keep their separate lock. */
export const canEnterStockCourt = (context: SettlementContext, actor: SettlementActor, destination: SettlementPoint) => {
  if (actor.stockBuilding === undefined) return true;
  const building = getBuilding(context, actor.stockBuilding);
  if (!building || !isCourtEntering(building, actor)) return true;
  // An unfinished site's input piles are ordinary construction access, not a finished
  // storage court; the per-slot handoffs already keep the three piles separate.
  if (building.construction < 1 && actor.phase === "deliveryStockWalk") return true;
  const inside = (point: SettlementPoint) => isInsideCourt(building, point);
  if (!inside(destination) && !inside(actor)) return true;
  let reservations = owners.get(context);
  if (!reservations) { reservations = new Map(); owners.set(context,reservations); }
  let owner = reservations.get(building.uid);
  if (owner && (!context.actors.includes(owner) || !isValidCourtOwner(building, owner))) {
    reservations.delete(building.uid); owner = undefined;
  }
  const cooldown = cooldowns.get(actor) ?? 0;
  if (!owner && cooldown > reservationTime(context)) return leaveCourt(context, actor, building);
  if (!owner) {
    owner = context.actors.filter(other => other !== actor && other.visible && other.stockBuilding === building.uid &&
      isCourtActive(building, other) && inside(other) && canClaimCourt(context, other)).sort((a,b)=>a.uid-b.uid)[0] ??
      longestStarvedWaiter(context, actor, building) ?? actor;
    reservations.set(building.uid,owner);
    if (owner === actor) {
      const ware = actor.ware ?? actor.delivery?.ware ?? actor.productionInputs?.[0];
      const kind = ["inputApproach", "deliveryStockWalk"].includes(actor.phase) ? "input" : "output";
      if (ware) {
        let inputStock = building.input[ware] ?? 0;
        if (isCatapultAmmoStock(building, ware))
          inputStock = building.catapultSupply?.ground ?? 0;
        const slot = kind === "input" ? Math.max(0,inputStock-(actor.phase === "inputApproach" ? 1 : 0))
          : Math.max(0,countGoods(building.output)-(actor.phase === "outputWalk" ? 0 : 1));
        const contact=stockContact(context,building,kind,ware,slot);
        const path=stockErrandPath(context,actor,building,contact.approach);
        if (path) {
          actor.stockContact=contact;
          setActorPath(actor,path,actor.phase);
          return false; // Follow the freshly chosen live slot on the next physical step.
        }
      }
    }
  }

  const starved = owner === actor && yieldsTurnToStarvedWaiter(context, actor, building);
  if (starved) {
    owner = starved;
    reservations.set(building.uid, starved);
  }
  watchCourt(context, reservations, owner, building, destination);
  if (owner === actor) { releaseCourtSlot(actor); queuedSince.delete(actor); return true; }
  if (inside(actor)) return leaveCourt(context, actor, building);
  if (actor.visible) queueOutsideCourt(context, actor, owner, building, destination);
  return false;
};
const watchCourt = (context: SettlementContext, reservations: Map<number, SettlementActor>,
  watched: SettlementActor, building: SettlementBuilding, destination: SettlementPoint) => {
  watchReservation(context, `court:${building.uid}`, watched,
    () => reservations.get(building.uid) === watched && isValidCourtOwner(building, watched),
    () => {
      reservations.delete(building.uid);
      cooldowns.set(watched, reservationTime(context) + .5 + (watched.uid % 4) * .5);
    }, watched.stockContact?.approach ?? destination);
};
/** A visible non-owner inside the court may only walk straight out of it. */
const leaveCourt = (context: SettlementContext, actor: SettlementActor, building: SettlementBuilding) =>
  actor.visible && isInsideCourt(building, actor) && stepOutOfCourt(context, actor, building);
/** A queued entrant waits at a fixed slot beside the court; a plain shoulder is only the fallback. */
const queueOutsideCourt = (context: SettlementContext, actor: SettlementActor, owner: SettlementActor,
  building: SettlementBuilding, destination: SettlementPoint) => {
  // A generic passing offset chosen before admission must not point into the reserved court.
  if (actor.queueTarget && isInsideCourt(building, actor.queueTarget)) actor.queueTarget = undefined;
  markQueued(context, actor, building);
  if (waitAtCourtSlot(context, actor, owner, building, actor.stockContact?.approach ?? destination)) return;
  // No free slot: a waiter out of the owner's way holds where it stands; hopping from shoulder to shoulder
  // after every pause looked like jitter in place (LOG-02).
  if (!isInOwnerCorridor(owner, actor)) return;
  const shoulder = !actor.queueTarget && chooseYieldTarget(context, actor, owner, destination, true,
    point => !isNearCourt(building, point));
  if (shoulder) setQueueTarget(actor, shoulder);
};
/** Passing offsets for a queued entrant must remain outside another crew's reserved yard. */
export const canUseStockYieldPoint = (context:SettlementContext, actor:SettlementActor, point:SettlementPoint) => {
  const owner=actor.stockBuilding===undefined ? undefined : owners.get(context)?.get(actor.stockBuilding);
  if (!owner || owner===actor) return true;
  const building=getBuilding(context, actor.stockBuilding);
  return !building || !isNearCourt(building, point);
};

/**
 * The admitted yard crew keeps right of way over queued arrivals; physical separation still applies.
 * A crew that has left its court (walking home) is an ordinary walker again and avoids others.
 */
export const ownsStockCourt = (context:SettlementContext,actor:SettlementActor) => {
  if (actor.stockBuilding === undefined || owners.get(context)?.get(actor.stockBuilding) !== actor) return false;
  const building = getBuilding(context, actor.stockBuilding);
  if (building && isValidCourtOwner(building, actor)) return true;
  owners.get(context)?.delete(actor.stockBuilding);
  return false;
};

/**
 * Two entrants meeting at a court entry (LOG-02: carriers 55 and 56 at the mill (72, 53.5) of save
 * 2026-10-20 (1) sidestepped in turn for 5 s). The one closer to the court goes first (the lower id on a tie,
 * a stable order); the other stands still. A wait is bounded, so a rival that cannot move never freezes it.
 */
const ENTRY_RIVAL_REACH = 1.2;
const ENTRY_APPROACH_REACH = 1.5;
const ENTRY_WAIT_SECONDS = 4;
const entryWaits = new WeakMap<SettlementActor, { rival: SettlementActor; since: number }>();
const courtDistance = (building: SettlementBuilding, point: SettlementPoint) => DMath.hypot(
  Math.max(0, Math.abs(point.x - building.x) - building.width / 2),
  Math.max(0, Math.abs(point.z - building.z) - building.depth / 2));
const isApproachingCourt = (building: SettlementBuilding, actor: SettlementActor) => actor.visible &&
  actor.stockBuilding === building.uid && isCourtEntering(building, actor) && !isInsideCourt(building, actor) &&
  courtDistance(building, actor) < ENTRY_APPROACH_REACH;
const goesFirst = (building: SettlementBuilding, other: SettlementActor, actor: SettlementActor) => {
  const own = courtDistance(building, actor), theirs = courtDistance(building, other);
  return theirs < own - 1e-6 || (Math.abs(theirs - own) <= 1e-6 && other.uid < actor.uid);
};
const findEntryRival = (context: SettlementContext, actor: SettlementActor, building: SettlementBuilding) =>
  context.actors.find(other => other !== actor && isApproachingCourt(building, other) &&
    DMath.hypot(other.x - actor.x, other.z - actor.z) < ENTRY_RIVAL_REACH && goesFirst(building, other, actor));
/** The entrant that this one waits for at the court entry, if any (its sidestep is then dropped). */
export const stockEntryRival = (context: SettlementContext, actor: SettlementActor) => {
  const building = getBuilding(context, actor.stockBuilding);
  if (!building || !isApproachingCourt(building, actor) || ownsStockCourt(context, actor)) return undefined;
  const rival = findEntryRival(context, actor, building);
  if (!rival) { entryWaits.delete(actor); return undefined; }
  const now = reservationTime(context), wait = entryWaits.get(actor);
  if (wait?.rival !== rival) { entryWaits.set(actor, { rival, since: now }); return rival; }
  return now - wait.since < ENTRY_WAIT_SECONDS ? rival : undefined;
};

/**
 * A standing entrant of the same stock court is the line this one queues in: it holds behind it
 * instead of sidestepping around it (LOG-02: up to 21 shoulder hops per entrant at a mill entry, and
 * hundreds at busy construction sites, all around peers that were only waiting their turn).
 */
export const isQueuedCourtPeer = (context: SettlementContext, actor: SettlementActor, other: SettlementActor) => {
  if (actor.stockBuilding === undefined || other.stockBuilding !== actor.stockBuilding) return false;
  const building = getBuilding(context, actor.stockBuilding);
  return !!building && isCourtEntering(building, actor) && isCourtEntering(building, other);
};

/** Meaningful admission/FIFO ages survive capture; only object references are reconstructed. */
export interface SavedStockTraffic {
  clock: number;
  owners: { building: number; actor: number; watch?: SavedReservationWatch }[];
  actors: { actor: number; phase: string; cooldown?: number; queued?: QueuedEntry; entry?: { rival: number; since: number } }[];
}
export const saveStockTraffic = (context: SettlementContext): SavedStockTraffic => ({
  clock: reservationTime(context),
  owners: [...owners.get(context) ?? []].flatMap(([uid, actor]) => {
    const site = getBuilding(context, uid);
    return site && context.actors.includes(actor)
      ? [{ building: uid, actor: actor.uid, watch: saveReservationWatch(context, `court:${uid}`, actor) }] : [];
  }),
  actors: context.actors.flatMap(actor => {
    const cooldown = cooldowns.get(actor), queued = queuedSince.get(actor), entry = entryWaits.get(actor);
    const validQueued = queued && getBuilding(context, queued.building) ? queued : undefined;
    const validEntry = entry && context.actors.includes(entry.rival) ? { rival: entry.rival.uid, since: entry.since } : undefined;
    return cooldown !== undefined || validQueued || validEntry
      ? [{ actor: actor.uid, phase: actor.phase, cooldown, queued: validQueued, entry: validEntry }] : [];
  })
});
export const restoreStockTraffic = (context: SettlementContext, saved?: SavedStockTraffic) => {
  if (!saved) return;
  restoreReservationTime(context, saved.clock);
  const actors = new Map(context.actors.map(actor => [actor.uid, actor]));
  const held = new Map<number, SettlementActor>(); owners.set(context, held);
  for (const value of saved.actors) {
    const actor = actors.get(value.actor)!;
    if (value.cooldown !== undefined) cooldowns.set(actor, value.cooldown);
    if (value.queued) queuedSince.set(actor, { ...value.queued });
    if (value.entry) entryWaits.set(actor, { rival: actors.get(value.entry.rival)!, since: value.entry.since });
  }
  for (const value of saved.owners) {
    const actor = actors.get(value.actor)!, building = getBuilding(context, value.building)!;
    held.set(value.building, actor);
    if (value.watch) {
      watchCourt(context, held, actor, building, actor.stockContact?.approach ?? actor.path.at(-1) ?? actor);
      restoreReservationWatch(context, `court:${value.building}`, value.watch);
    }
  }
};
