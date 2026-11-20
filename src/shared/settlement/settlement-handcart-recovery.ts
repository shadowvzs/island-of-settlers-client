import { cartHitchPoint } from "../../render-common/logistics/handcart-rules";
import { DMath } from "../math/deterministic-math";
import { handcartTripLeaseExpired } from "./settlement-carrier-claims";
import { releaseLayByClaims, releaseLayByClaimsForBuilding } from "./settlement-carrier-laybys";
import { entrancePath } from "./settlement-entrance";
import {
  cancelEmptyTrip,
  closeLoading,
  depositOneItem,
  findBuilding,
  isCompletedStorage,
  nearestStorageWithCartRoom,
  releaseDestination,
  shelveHandcarts
} from "./settlement-handcart-ledger";
import {
  departLoaded,
  HANDCART_RETRY_SECONDS,
  parkCart,
  salvageByCart,
  startCartReturn
} from "./settlement-handcart-moves";
import { footRouteFrom } from "./settlement-handcart-roads";
import { findFactionHome } from "./settlement-home";
import { actorEconomyOwnerOf, servesEconomyOf } from "./settlement-ownership";
import { moveActor, setActorPath } from "./settlement-paths";
import type {
  SettlementActor,
  SettlementBuilding,
  SettlementContext,
  SettlementPoint
} from "./settlement-types";

/**
 * A parked cart is unloaded by hand, one item per walk: to its destination when that is still
 * reachable on foot, otherwise to the nearest reachable storage. Cargo never vanishes: when no
 * walk is possible the items stay on the parked cart (the ground pile) and the carrier retries.
 */
export const RECOVERY_PHASES = new Set(["cartRecover", "cartShuttleOut", "cartShuttleBack"]);

const hitchPoint = (actor: SettlementActor): SettlementPoint => {
  const parked = actor.handcart!.parked;
  return parked ? cartHitchPoint(parked.x, parked.z, parked.yaw) : { x: actor.x, z: actor.z };
};

const waitAtCart = (actor: SettlementActor) => {
  actor.action = "idle";
  actor.timer = HANDCART_RETRY_SECONDS;
};

const nearestReachableStorage = (context: SettlementContext, actor: SettlementActor, ware: string) => {
  const owner = actorEconomyOwnerOf(context, actor);
  const storages = context.buildings.filter(building =>
    isCompletedStorage(building) && servesEconomyOf(context, building, owner) && building.accepts[ware] !== false)
    .sort((a, b) => DMath.hypot(a.access.x - actor.x, a.access.z - actor.z) -
      DMath.hypot(b.access.x - actor.x, b.access.z - actor.z) || a.uid - b.uid);
  for (const storage of storages) {
    const route = footRouteFrom(context, actor, storage.access);
    if (route) return { building: storage, path: route };
  }
  return null;
};

/**
 * Destination first (it still expects the items), then the nearest storage that accepts them.
 * The destination keeps its claim while nothing at all is reachable, so a reconnection delivers there.
 */
const chooseShuttleTarget = (context: SettlementContext, actor: SettlementActor) => {
  const trip = actor.handcart!.trip!;
  const destination = findBuilding(context, trip.destination);
  // A destination that stopped accepting the ware cannot receive the recovered item. Fall through
  // to the accepting-storage search and release the stale promise once a receiver is found.
  const path = destination && destination.accepts[trip.ware] !== false &&
    footRouteFrom(context, actor, destination.access);
  if (destination && path) return { building: destination, path };
  const fallback = nearestReachableStorage(context, actor, trip.ware);
  if (fallback && destination) releaseDestination(context, trip);
  return fallback;
};

/**
 * Re-points an already-recovering hand cart after its target stops accepting the ware. The cart and
 * any item in the carrier's hand stay owned; only the old incoming promise is released. A backed-off
 * or parked cart clears its target and lets `cartRecover` choose the replacement on the next step.
 */
export const redirectHandcartRecoveryDelivery = (
  context: SettlementContext,
  actor: SettlementActor,
  disabledUid: number,
  ware: string
) => {
  const cart = actor.handcart, trip = cart?.trip;
  if (!cart || !trip || trip.ware !== ware || !RECOVERY_PHASES.has(actor.phase)) return false;
  if (cart.shuttleTarget !== disabledUid && trip.destination !== disabledUid) return false;
  if (trip.destination === disabledUid) releaseDestination(context, trip);
  if (actor.phase === "cartShuttleOut" && actor.ware === ware && cart.shuttleTarget === disabledUid) {
    const next = nearestReachableStorage(context, actor, ware);
    if (next) {
      cart.shuttleTarget = next.building.uid;
      setActorPath(actor, next.path, "cartShuttleOut");
      return true;
    }
  }
  cart.shuttleTarget = undefined;
  if (actor.phase === "cartRecover") actor.timer = 0;
  return true;
};

/** Takes one item off the bed (unless one is already in hand) and walks it to a receiver. */
const startShuttle = (context: SettlementContext, actor: SettlementActor) => {
  const cart = actor.handcart!;
  const target = chooseShuttleTarget(context, actor);
  if (!target) return false;
  if (!actor.ware) {
    cart.cargo--;
    actor.ware = cart.trip!.ware;
  }
  cart.shuttleTarget = target.building.uid;
  setActorPath(actor, target.path, "cartShuttleOut");
  return true;
};

const recoverAtCart = (context: SettlementContext, actor: SettlementActor, dt: number) => {
  actor.timer -= dt;
  if (actor.timer > 0) return;
  const cart = actor.handcart!;
  if (cart.cargo > 0 && cart.trip) {
    if (!startShuttle(context, actor)) waitAtCart(actor);
    return;
  }
  if (!startCartReturn(context, actor)) waitAtCart(actor);
};

const finishShuttle = (context: SettlementContext, actor: SettlementActor) => {
  const cart = actor.handcart!;
  const target = findBuilding(context, cart.shuttleTarget);
  if (!target) {
    if (!startShuttle(context, actor)) waitAtCart(actor);
    return;
  }
  if (!depositOneItem(context, cart.trip!, target)) return;
  target.door = 1;
  actor.ware = null;
  cart.shuttleTarget = undefined;
  walkBackToCart(context, actor);
};

/**
 * A cart claim that stopped making progress is released deterministically. Before the first item
 * the prepaid source stock and every unfilled slot are refunded; after the first item the loaded
 * cargo stays on the bed and only the destination promise is released. Recovery then shuttles the
 * preserved cargo to a reachable receiver instead of teleporting or deleting it.
 */
export const expireHandcartTrip = (context: SettlementContext, actor: SettlementActor) => {
  const cart = actor.handcart, trip = cart?.trip;
  if (!cart || !trip || actor.bridgeWait || !handcartTripLeaseExpired(context, trip)) return false;
  // Expiry ends ownership of every reserved bay; the cart and cargo are then recovered in place.
  releaseLayByClaims(cart);
  const carrying = cart.cargo > 0 || actor.ware === trip.ware;
  if (!carrying && cart.state === "stored") {
    // The cart never left its shed: release the trip and put it back on the shelf.
    returnUnusedCart(context, actor);
    return true;
  }
  releaseDestination(context, trip);
  trip.leaseStartedTick = undefined;
  trip.leaseDeadlineTick = undefined;
  actor.navigationRecovery = undefined;
  // The old receiver no longer holds a claim; retarget the preserved item to a reachable store.
  if (carrying) cart.shuttleTarget = undefined;
  if (RECOVERY_PHASES.has(actor.phase) || actor.ware === trip.ware) return true;
  if (carrying) {
    // Keep the trip for the shuttle: its destination is now undefined, cargo stays on the bed.
    parkCart(actor);
    return true;
  }
  cancelEmptyTrip(context, cart);
  if (!startCartReturn(context, actor)) parkCart(actor);
  return true;
};

export const walkBackToCart = (context: SettlementContext, actor: SettlementActor) => {
  const path = footRouteFrom(context, actor, hitchPoint(actor));
  if (path) setActorPath(actor, [...path, hitchPoint(actor)], "cartShuttleBack");
  else {
    actor.phase = "cartShuttleBack";
    actor.path = [];
    waitAtCart(actor);
  }
};

export const updateHandcartRecovery = (context: SettlementContext, actor: SettlementActor, dt: number) => {
  if (actor.phase === "cartRecover") return recoverAtCart(context, actor, dt);
  if (actor.phase === "cartShuttleBack" && !actor.path.length) {
    actor.timer -= dt;
    if (actor.timer <= 0) walkBackToCart(context, actor);
    return;
  }
  if (!moveActor(context, actor, dt)) return;
  if (actor.phase === "cartShuttleOut") return finishShuttle(context, actor);
  actor.phase = "cartRecover";
  actor.action = "idle";
  actor.timer = 0;
};

/** The cart never left its shed: the trip ends and the cart goes back on the shelf. */
const returnUnusedCart = (context: SettlementContext, actor: SettlementActor) => {
  const cart = actor.handcart!;
  cancelEmptyTrip(context, cart);
  const owner = findBuilding(context, cart.owner) ?? findFactionHome(context, actorEconomyOwnerOf(context, actor))!;
  shelveHandcarts(context, owner, 1, actor);
  actor.handcart = undefined;
  const home = findBuilding(context, actor.home);
  if (!home) return true;
  actor.building = home.uid;
  if (!actor.visible) {
    actor.phase = "inside";
    actor.path = [];
    return false;
  }
  setActorPath(actor, entrancePath(home), "enterHome");
  return false;
};

/** Loading ends early when the source is gone; a trip with an empty bed ends there and then. */
const handleLostSource = (context: SettlementContext, actor: SettlementActor) => {
  const cart = actor.handcart!;
  closeLoading(context, cart.trip!);
  if (cart.cargo > 0) {
    if (actor.phase === "cartLoading") departLoaded(context, actor);
    return;
  }
  cancelEmptyTrip(context, cart);
  if (cart.state === "hitched" && !startCartReturn(context, actor)) parkCart(actor);
};

const handleLostDestination = (context: SettlementContext, actor: SettlementActor) => {
  const cart = actor.handcart!;
  const trip = cart.trip!;
  // Its `incoming` promise and bay vanished with the building; salvage needs no stale reservation.
  releaseLayByClaims(cart, "destination");
  trip.destination = undefined;
  closeLoading(context, trip);
  if (cart.cargo === 0 && !actor.ware) {
    cancelEmptyTrip(context, cart);
    if (cart.state === "hitched" && !startCartReturn(context, actor)) parkCart(actor);
    return;
  }
  if (cart.state === "hitched") salvageByCart(context, actor);
};

/** A cart whose storage was demolished moves to the nearest one with room (else the home dismantles it). */
const adoptiveStorage = (context: SettlementContext, actor: SettlementActor) =>
  nearestStorageWithCartRoom(context, actor, actor) ?? findFactionHome(context, actorEconomyOwnerOf(context, actor))!;

/**
 * Runs after `removed` left the building list, so refunds can never land in demolished stock.
 * Returns true when the carrier (now without a cart) still needs the generic demolition return.
 */
export const recoverHandcartAfterDemolition = (
  context: SettlementContext,
  actor: SettlementActor,
  removed: SettlementBuilding
) => {
  const cart = actor.handcart!;
  releaseLayByClaimsForBuilding(cart, removed.uid);
  const returningThere = actor.phase === "cartReturn" && cart.owner === removed.uid;
  if (cart.owner === removed.uid) cart.owner = adoptiveStorage(context, actor).uid;
  if (cart.state === "stored") return returnUnusedCart(context, actor);
  if (cart.trip?.source === removed.uid) handleLostSource(context, actor);
  if (cart.trip?.destination === removed.uid) handleLostDestination(context, actor);
  if (cart.shuttleTarget === removed.uid) {
    cart.shuttleTarget = undefined;
    if (!startShuttle(context, actor)) waitAtCart(actor);
  }
  if (returningThere && !startCartReturn(context, actor)) parkCart(actor);
  if (actor.home === removed.uid) actor.home = cart.owner;
  if (actor.building === removed.uid) actor.building = cart.trip?.destination ?? cart.owner;
  return false;
};
