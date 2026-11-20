import { DMath } from "../math/deterministic-math";
import { CIVILIAN_THREAT_RADIUS } from "./military-civilian-safety";
import { exitPath } from "./settlement-entrance";
import { canCrewCart, CART_EXIT_PHASE, crewForCart } from "./settlement-handcart-crew";
import { findBuilding, hasCartRoom, isCompletedStorage } from "./settlement-handcart-ledger";
import { isOwnBuilding } from "./settlement-home";
import { setActorPath } from "./settlement-paths";
import type { AbandonedHandcart, SettlementBuilding, SettlementContext } from "./settlement-types";

/**
 * Abandoned carts (settlement-handcart-abandon.ts) are fetched like a Sawmill's new cart: a free
 * carrier leaves its storage, walks to the cart and pulls it home, unloading any load left on the bed.
 */
const distanceTo = (storage: SettlementBuilding, cart: AbandonedHandcart) =>
  DMath.hypot(storage.access.x - cart.x, storage.access.z - cart.z);

/** A storage that can send a carrier now: completed, crewed, its door safe; its own cart always fits. */
const canSendCollector = (context: SettlementContext, storage: SettlementBuilding, cart: AbandonedHandcart) =>
  isCompletedStorage(storage) && isOwnBuilding(storage) &&
  (storage.uid === cart.owner || hasCartRoom(context, storage)) && canCrewCart(context, storage) &&
  !context.civilianThreat?.doorThreatened(storage);

/** The owner storage first, otherwise the nearest one with room for one more cart (ties by uid). */
const collectorStorage = (context: SettlementContext, cart: AbandonedHandcart) => {
  const owner = findBuilding(context, cart.owner);
  if (owner && canSendCollector(context, owner, cart)) return owner;
  let best: SettlementBuilding | undefined;
  for (const storage of context.buildings) {
    if (!canSendCollector(context, storage, cart)) continue;
    if (!best || distanceTo(storage, cart) < distanceTo(best, cart)) best = storage;
  }
  return best;
};

/** A load left on the bed is unloaded by hand to the nearest accepting storage (the cart recovery). */
const recoveryTrip = (storage: SettlementBuilding, cart: AbandonedHandcart) => cart.cargo && cart.ware
  ? { delivered: 0, loaded: cart.cargo, planned: cart.cargo, prepaid: 0, source: storage.uid, ware: cart.ware }
  : undefined;

const sendCollector = (context: SettlementContext, cart: AbandonedHandcart, storage: SettlementBuilding) => {
  const actor = crewForCart(context, storage);
  actor.home = storage.uid;
  actor.building = storage.uid;
  const trip = recoveryTrip(storage, cart);
  actor.handcart = { cargo: trip ? cart.cargo! : 0, owner: storage.uid,
    parked: { x: cart.x, yaw: cart.yaw, z: cart.z }, state: "parked", ...(trip ? { trip } : {}) };
  setActorPath(actor, exitPath(storage), CART_EXIT_PHASE);
};

/**
 * Runs with the delivery scheduler: each abandoned cart clear of raiders is fetched by a free carrier
 * (or a settler recruited as one) of its storage, else of the nearest storage with room.
 */
export const collectAbandonedHandcarts = (context: SettlementContext) => {
  const carts = context.abandonedHandcarts;
  if (!carts?.length) return;
  for (let index = 0; index < carts.length; index++) {
    const cart = carts[index]!;
    if (context.civilianThreat?.enemyWithin(cart, CIVILIAN_THREAT_RADIUS)) continue;
    const storage = collectorStorage(context, cart);
    if (!storage) continue;
    carts.splice(index--, 1);
    sendCollector(context, cart, storage);
  }
  if (!carts.length) context.abandonedHandcarts = undefined;
};
