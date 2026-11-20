import { refreshClaimLease } from "./settlement-carrier-claims";
import { carrierRoadRecoveryPath } from "./settlement-carrier-road-recovery";
import { setActorPath } from "./settlement-paths";
import { createTransientMap } from "./settlement-transient-state";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";
import { relocateToStorage } from "./stranded-relocation";

/** Owner 2026-11-07: a cut-off carrier gives up after about five minutes (not saved: a load resolves it). */
export const BRIDGE_WAIT_FADE_SECONDS = 300;

/**
 * Graph revisions a waiting actor last checked. Transient: after a load the first tick checks once,
 * and the answer depends only on saved state, so a reloaded and a resumed island agree.
 */
const checkedRevisions = new WeakMap<SettlementActor, string>();
/** Seconds each carrier has waited, by actor uid; a load empties it (and resolves every wait). */
const waitedSeconds = createTransientMap<Map<number, number>>();

const revisionKey = (context: SettlementContext) =>
  `${context.options.roads.revision ?? 0}/${context.navigationRevision ?? 0}`;

/**
 * Stops a road journey that a removed bridge cut: the actor keeps its phase, delivery and cargo and
 * stands on its current spot (its path collapses to that spot) until a route exists again.
 */
export const beginBridgeWait = (actor: SettlementActor, destination: SettlementPoint) => {
  actor.bridgeWait = { destination: { x: destination.x, z: destination.z } };
  actor.path = [{ x: actor.x, z: actor.z }];
  actor.pathIndex = 0;
  actor.queueTarget = undefined;
  actor.queueWait = 0;
  actor.navigationRecovery = undefined;
  actor.action = "idle";
  checkedRevisions.delete(actor);
};

/** Plain carriers give up; hand carts and other jobs keep waiting for a crossing. */
const givesUp = (actor: SettlementActor) => actor.job === "Carrier" && !actor.handcart;

const waitedLongEnough = (context: SettlementContext, actor: SettlementActor, dt: number) => {
  if (!givesUp(actor)) return false;
  const waited = waitedSeconds.get(context) ?? new Map<number, number>();
  waitedSeconds.set(context, waited);
  const seconds = (waited.get(actor.uid) ?? 0) + dt;
  waited.set(actor.uid, seconds);
  return seconds >= BRIDGE_WAIT_FADE_SECONDS;
};

const resumeJourney = (context: SettlementContext, actor: SettlementActor, path: SettlementPoint[]) => {
  actor.bridgeWait = undefined;
  checkedRevisions.delete(actor);
  waitedSeconds.get(context)?.delete(actor.uid);
  setActorPath(actor, path, actor.phase);
  if (actor.delivery) refreshClaimLease(context, actor.delivery);
  if (actor.handcart?.trip) refreshClaimLease(context, actor.handcart.trip);
};

/**
 * True while the actor still waits. A road or navigation edit (or the first tick after a load)
 * re-checks the join to the road graph; a found route resumes the same journey with a fresh claim
 * lease. A carrier still cut off after `BRIDGE_WAIT_FADE_SECONDS` returns to a storage instead.
 */
export const holdBridgeWait = (context: SettlementContext, actor: SettlementActor, dt: number) => {
  const wait = actor.bridgeWait;
  if (!wait) return false;
  actor.action = "idle";
  const key = revisionKey(context);
  if (checkedRevisions.get(actor) !== key) {
    checkedRevisions.set(actor, key);
    const resumed = carrierRoadRecoveryPath(context, actor, wait.destination);
    if (resumed) {
      resumeJourney(context, actor, resumed.path);
      return false;
    }
  }
  if (waitedLongEnough(context, actor, dt)) relocateToStorage(context, actor);
  return true;
};

/**
 * Load-time resolution: the wait timer is not saved, so every carrier still cut off returns to a
 * storage at once. Client, offline catch-up and server verifier all load through here, so they agree.
 */
export const resolveLoadedBridgeWaits = (context: SettlementContext) => {
  for (const actor of context.actors)
    if (actor.bridgeWait && givesUp(actor) && !carrierRoadRecoveryPath(context, actor, actor.bridgeWait.destination))
      relocateToStorage(context, actor);
};
