import { createActor } from "./settlement-paths";
import { availableIdleSettlers } from "./settlement-population";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

/** The ordinary storage exit phase, so door queues, lanes and demolition treat it alike. */
export const CART_EXIT_PHASE = "assigned";

const idleCarrierAt = (context: SettlementContext, storage: SettlementBuilding) =>
  (context.actors ?? []).find(actor => actor.job === "Carrier" && actor.phase === "inside" &&
    actor.home === storage.uid && actor.building === storage.uid &&
    !context.buildings.some(building => building.worker === actor.uid) && !actor.delivery && !actor.handcart && !actor.ware);

/** A storage can send a cart out when an idle carrier or an idle settler is inside. */
export const canCrewCart = (context: SettlementContext, storage: SettlementBuilding) =>
  !!idleCarrierAt(context, storage) || availableIdleSettlers(context, storage) > 0;

/** The storage's idle carrier, otherwise a settler recruited as one (check `canCrewCart` first). */
export const crewForCart = (context: SettlementContext, storage: SettlementBuilding) =>
  idleCarrierAt(context, storage) ?? createActor(context, "Carrier", storage.uid);
