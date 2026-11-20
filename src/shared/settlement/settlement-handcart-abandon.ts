import { cartCentreBehind } from "../../render-common/logistics/handcart-rules";
import { releaseLayByClaims } from "./settlement-carrier-laybys";
import {
  findBuilding, hasCartRoom, refundHandcarts, releaseDestination, shelveHandcarts
} from "./settlement-handcart-ledger";
import { findFactionHome } from "./settlement-home";
import { actorEconomyOwnerOf } from "./settlement-ownership";
import type {
  SettlementActor, SettlementBuilding, SettlementContext, SettlementHandcart
} from "./settlement-types";

/**
 * Carts that lost their crew to raiders (MIL-CREWS, owner 2026-11-09). The cart stops where it stands with
 * the load on its bed. The destination's promise, unloaded prepaid stock and lay-by bays are released at
 * once, and the cart stays its storage's until a free carrier of a storage with room fetches it (as a
 * Sawmill's new cart is) and unloads the bed into a storage. A killed puller's bed load is lost with it
 * (MIL-TWEAKS, owner 2026-11-09): `loseKilledPullerLoad`; a puller that runs and lives keeps it.
 */
type ClaimContext = Pick<SettlementContext, "abandonedHandcarts" | "actors" | "buildings">;

const standOf = (actor: SettlementActor, cart: SettlementHandcart) =>
  cart.parked ?? { ...cartCentreBehind(actor.x, actor.z, actor.yaw), yaw: actor.yaw };

/** The load left on the bed. */
const bedLoad = (cart: SettlementHandcart) =>
  cart.trip && cart.cargo > 0 ? { cargo: cart.cargo, ware: cart.trip.ware } : {};

/**
 * The crew is killed or runs: the cart leaves the person. A cart still in its shed goes back on the
 * shelf; one outside stands where it is, abandoned, with its bed's load.
 */
export const abandonHandcart = (context: ClaimContext, actor: SettlementActor) => {
  const cart = actor.handcart;
  if (!cart) return;
  releaseLayByClaims(cart);
  // Unfilled slots and prepaid stock go back; the destination no longer expects anything.
  if (cart.trip) releaseDestination(context as SettlementContext, cart.trip);
  actor.handcart = undefined;
  actor.locomotionSpeed = undefined;
  if (cart.state === "stored") {
    const owner = findBuilding(context as SettlementContext, cart.owner) ??
      findFactionHome(context, actorEconomyOwnerOf(context as SettlementContext, actor));
    if (owner) shelveHandcarts(context as SettlementContext, owner, 1);
    return;
  }
  const stand = standOf(actor, cart);
  (context.abandonedHandcarts ??= []).push({ id: actor.uid, owner: cart.owner, x: stand.x, yaw: stand.yaw,
    z: stand.z, ...bedLoad(cart) });
};

/**
 * The puller `uid` was killed: the load on the bed of the cart it left (just now, or when it parked and
 * ran) is lost with it; the empty cart still waits to be fetched. The destination's promise was already
 * released when the cart was abandoned, and a cart a collector has taken is no longer listed.
 */
export const loseKilledPullerLoad = (context: Pick<SettlementContext, "abandonedHandcarts">, uid: number) => {
  for (const cart of context.abandonedHandcarts ?? []) {
    if (cart.id !== uid) continue;
    delete cart.cargo;
    delete cart.ware;
  }
};

/**
 * A demolished storage's abandoned carts belong to a storage with room; with none left the cart is
 * taken apart into the first remaining storage's stock (as its shelved carts are).
 */
export const rehomeAbandonedHandcarts = (
  context: SettlementContext, removed: SettlementBuilding, stores: readonly SettlementBuilding[]
) => {
  const carts = context.abandonedHandcarts;
  if (!carts?.length) return;
  for (let index = 0; index < carts.length; index++) {
    const cart = carts[index]!;
    if (cart.owner !== removed.uid) continue;
    const storage = stores.find(candidate => candidate !== removed && hasCartRoom(context, candidate));
    if (storage) { cart.owner = storage.uid; continue; }
    carts.splice(index--, 1);
    if (stores[0] && stores[0] !== removed) refundHandcarts(stores[0], 1);
  }
  if (!carts.length) context.abandonedHandcarts = undefined;
};
