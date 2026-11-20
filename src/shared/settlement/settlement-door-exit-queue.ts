import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";

/**
 * Carriers dispatched from a storage but still indoors, waiting for their turn through its door. One door lets
 * them out one at a time (about one every 2–3 s at a busy HQ), so more queued carriers only wait longer inside
 * (LOG-02: up to 98 s, mean 50 s; about 10 s with this limit) without moving any ware sooner. A few ready
 * behind the door keep it busy and still let a burst recruit several carriers at once.
 */
export const DOOR_EXIT_QUEUE_LIMIT = 4;

const OUTBOUND_PHASES = new Set(["exitLoaded", "pickup"]);

const isQueuedIndoors = (actor: SettlementActor, uid: number) =>
  !actor.visible && actor.home === uid && actor.job === "Carrier" && OUTBOUND_PHASES.has(actor.phase);

/** The storage's door already has enough carriers queued indoors to leave: dispatch no further one now. */
export const isDoorExitQueueFull = (context: SettlementContext, building: SettlementBuilding) => {
  if (!building.hasDoor) return false;
  let queued = 0;
  for (const actor of context.actors) {
    if (isQueuedIndoors(actor, building.uid) && ++queued >= DOOR_EXIT_QUEUE_LIMIT) return true;
  }
  return false;
};
