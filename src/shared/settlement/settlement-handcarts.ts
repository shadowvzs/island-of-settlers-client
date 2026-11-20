import { HANDCART_LOGISTICS } from "../balance/economy";
import { addGood } from "./production-rules";
import {
  carrierClaimProgress, refreshCarrierClaimOnProgress, startClaimLease
} from "./settlement-carrier-claims";
import type { CarrierFleetAssignment } from "./settlement-carrier-fleet";
import {
  claimCartLayBys, expireLayByClaims, refreshLayByClaimsOnProgress, releaseLayByClaims
} from "./settlement-carrier-laybys";
import { leaveStorageArrival } from "./settlement-door-traffic";
import { exitPath } from "./settlement-entrance";
import { CART_EXIT_PHASE, crewForCart } from "./settlement-handcart-crew";
import {
  canAdoptCart,
  closeLoading,
  depositOneItem,
  findBuilding,
  isCompletedStorage,
  loadOneItem,
  storageCartCount
} from "./settlement-handcart-ledger";
import {
  departLoaded,
  finishCartReturn,
  hitchCart,
  parkCart,
  setCartPath,
  startCartReturn
} from "./settlement-handcart-moves";
import {
  expireHandcartTrip,
  RECOVERY_PHASES,
  updateHandcartRecovery,
  walkBackToCart
} from "./settlement-handcart-recovery";
import { isStonePath, stoneRouteFrom } from "./settlement-handcart-roads";
import { reconcileNextDelivery, releaseNextDelivery } from "./settlement-land-transport-claims";
import { canReuseReturningHandcart } from "./settlement-land-transport-reuse";
import { roadRevisionSinceLoad } from "./settlement-load-revisions";
import { moveActor, setActorPath } from "./settlement-paths";
import type {
  SettlementActor,
  SettlementBuilding,
  SettlementContext
} from "./settlement-types";
import { reserveStorageDispatch, storageDispatchLimit } from "./storage-capacity";

const TRAVEL_PHASES = new Set(["cartToSource", "cartToDestination", "cartReturn"]);

/**
 * Commits the plan-time fleet decision. The decision already checked the route, minimum load,
 * depot/crew and both lay-bys; this function only moves stock and creates the trip once.
 */
export const dispatchHandcart = (
  context: SettlementContext,
  source: SettlementBuilding,
  destination: SettlementBuilding,
  ware: string,
  assignment: CarrierFleetAssignment
) => {
  if (!HANDCART_LOGISTICS.enabled || assignment.fleet !== "handcart" || !assignment.depot) return 0;
  const count = assignment.units;
  if (count < HANDCART_LOGISTICS.minItems) return 0;
  if (storageDispatchLimit(context, source, destination, ware, count) < count) return 0;
  const depot = assignment.depot;
  const actor = assignment.carrier ?? crewForCart(context, depot);
  let approach: ReturnType<typeof stoneRouteFrom> | undefined;
  if (assignment.carrier) {
    const cart = actor.handcart;
    const finished = actor.phase === "cartUnloading" && cart?.cargo === 0 && cart.trip &&
      cart.trip.delivered === cart.trip.planned && cart.trip.prepaid === 0;
    if (!cart || cart.owner !== depot.uid || (!finished && !canReuseReturningHandcart(actor))) return 0;
    approach = stoneRouteFrom(context, actor, source.access);
    if (!approach) return 0;
  }
  // Reserve both static bays before touching stock; a stale/duplicate claim returns 0 and the
  // caller falls back to the cartless carrier without leaving a half-created trip.
  const bays = claimCartLayBys(context, actor.uid, source, destination);
  if (!bays) return 0;
  if (!assignment.carrier) depot.handcarts = depot.handcarts! - 1;
  const prepaid = isCompletedStorage(source) ? count : 0;
  if (prepaid) addGood(source.inventory, ware, -prepaid);
  addGood(destination.incoming, ware, count);
  reserveStorageDispatch(context, source, destination, ware, count);
  actor.home = depot.uid;
  actor.building = depot.uid;
  const trip = {
    delivered: 0, destination: destination.uid, loaded: 0, planned: count, prepaid,
    capacity: assignment.capacity, source: source.uid, ...startClaimLease(context), ware
  };
  if (assignment.carrier) {
    const cart = actor.handcart!;
    Object.assign(cart, { bays, cargo: 0, trip });
    leaveStorageArrival(context, actor);
    actor.building = destination.uid;
    setCartPath(context, actor, approach!.points, "cartToSource");
  } else {
    actor.handcart = { cargo: 0, owner: depot.uid, state: "stored", bays, trip };
    setActorPath(actor, exitPath(depot), CART_EXIT_PHASE);
  }
  return count;
};

/**
 * At the storage's road endpoint the carrier takes the cart out of its shed, or walks on to a
 * cart parked elsewhere (a new one in a Sawmill yard) and pulls that one home.
 */
const leaveDepot = (context: SettlementContext, actor: SettlementActor) => {
  const cart = actor.handcart!;
  if (cart.state === "parked") return walkBackToCart(context, actor);
  hitchCart(actor);
  const trip = cart.trip;
  if (!trip) {
    if (!startCartReturn(context, actor)) parkCart(actor);
    return;
  }
  const source = findBuilding(context, trip.source)!;
  actor.building = trip.destination ?? cart.owner;
  if (source.uid === cart.owner) return beginLoading(context, actor);
  const route = stoneRouteFrom(context, actor, source.access);
  if (route) return setCartPath(context, actor, route.points, "cartToSource");
  abandonEmptyTrip(context, actor);
};

const beginLoading = (context: SettlementContext, actor: SettlementActor) => {
  actor.phase = "cartLoading";
  actor.action = "idle";
  actor.path = [];
  actor.pathIndex = 0;
  actor.timer = HANDCART_LOGISTICS.itemSeconds;
  const source = findBuilding(context, actor.handcart!.trip!.source);
  if (source && isCompletedStorage(source)) updateLoading(context, actor, 0);
};

/** Storage handling is immediate; production yards move one item per interval, including partial loads. */
const updateLoading = (context: SettlementContext, actor: SettlementActor, dt: number) => {
  actor.action = "idle";
  const cart = actor.handcart!, trip = cart.trip!;
  const source = findBuilding(context, trip.source);
  const instant = !!source && isCompletedStorage(source);
  actor.timer -= dt;
  if (!instant && actor.timer > 0) return;
  actor.timer = HANDCART_LOGISTICS.itemSeconds;
  const count = instant ? trip.planned - trip.loaded : 1;
  let loaded = false;
  for (let item = 0; item < count && trip.loaded < trip.planned; item++) {
    loaded = loadOneItem(context, cart);
    if (!loaded) break;
  }
  if (loaded && trip.loaded < trip.planned) return;
  closeLoading(context, trip);
  if (cart.cargo > 0) return departLoaded(context, actor);
  cart.trip = undefined;
  if (!startCartReturn(context, actor)) parkCart(actor);
};

const updateUnloading = (context: SettlementContext, actor: SettlementActor, dt: number) => {
  actor.action = "idle";
  const cart = actor.handcart!;
  const destination = findBuilding(context, cart.trip!.destination);
  if (!destination) {
    releaseLayByClaims(cart, "destination");
    return parkCart(actor);
  }
  const instant = isCompletedStorage(destination);
  actor.timer -= dt;
  if (!instant && actor.timer > 0) return;
  actor.timer = HANDCART_LOGISTICS.itemSeconds;
  const count = instant ? cart.cargo : Math.min(1, cart.cargo);
  for (let item = 0; item < count; item++) {
    if (!depositOneItem(context, cart.trip!, destination)) return;
    cart.cargo--;
    destination.door = 1;
  }
  if (cart.cargo > 0) return;
  // Service at this flag is complete: the bay is free for the next cart before the trip unwinds.
  releaseLayByClaims(cart, "destination");
  if (context.tryReuseTransport?.(actor, destination)) return;
  // A cart unloaded at a storage with room stays there; the puller goes in through that door.
  if (canAdoptCart(context, destination, actor)) cart.owner = destination.uid;
  if (!startCartReturn(context, actor)) parkCart(actor);
};

/** A trip that cannot reach its source over stone ends; an empty cart then heads home. */
const abandonEmptyTrip = (context: SettlementContext, actor: SettlementActor) => {
  const cart = actor.handcart!;
  closeLoading(context, cart.trip!);
  cart.trip = undefined;
  if (!startCartReturn(context, actor)) parkCart(actor);
};

/**
 * A road edit must never leave a cart on dirt: keep a still-stone route, replan entirely over
 * stone, or stop and unload by hand. Empty returns also re-plan entirely over stone.
 */
const verifyCartRoute = (context: SettlementContext, actor: SettlementActor) => {
  const cart = actor.handcart!;
  const revision = roadRevisionSinceLoad(context);
  if (cart.roadRevision === revision) return;
  if (actor.phase === "cartReturn") {
    if (!startCartReturn(context, actor)) parkCart(actor);
    return;
  }
  if (isStonePath(context, [actor, ...actor.path.slice(actor.pathIndex)])) {
    cart.roadRevision = revision;
    return;
  }
  const target = actor.path.at(-1);
  const route = target && stoneRouteFrom(context, actor, target);
  if (route) setCartPath(context, actor, route.points, actor.phase);
  else if (actor.phase === "cartToSource") abandonEmptyTrip(context, actor);
  else parkCart(actor);
};

const arrive = (context: SettlementContext, actor: SettlementActor) => {
  if (actor.phase === "cartToSource") return beginLoading(context, actor);
  if (actor.phase === "cartReturn") return finishCartReturn(context, actor);
  actor.phase = "cartUnloading";
  actor.action = "idle";
  actor.timer = HANDCART_LOGISTICS.itemSeconds;
  const destination = findBuilding(context, actor.handcart!.trip!.destination);
  if (destination && isCompletedStorage(destination)) updateUnloading(context, actor, 0);
};

const updateTravel = (context: SettlementContext, actor: SettlementActor, dt: number) => {
  verifyCartRoute(context, actor);
  // The check may have parked the cart or shelved it at a storage it already stood beside.
  if (!actor.handcart || !TRAVEL_PHASES.has(actor.phase)) return;
  if (moveActor(context, actor, dt)) arrive(context, actor);
};

const updateHandcartCarrierStep = (
  context: SettlementContext, actor: SettlementActor, dt: number
) => {
  if (actor.phase === CART_EXIT_PHASE) {
    if (moveActor(context, actor, dt)) leaveDepot(context, actor);
  } else if (TRAVEL_PHASES.has(actor.phase)) updateTravel(context, actor, dt);
  else if (actor.phase === "cartLoading") updateLoading(context, actor, dt);
  else if (actor.phase === "cartUnloading") updateUnloading(context, actor, dt);
  else if (RECOVERY_PHASES.has(actor.phase)) updateHandcartRecovery(context, actor, dt);
  else parkCart(actor);
};

/** Drives a carrier that owns a cart (from its shed until the cart is stored again). */
export const updateHandcartCarrier = (context: SettlementContext, actor: SettlementActor, dt: number) => {
  reconcileNextDelivery(context, actor);
  if (expireHandcartTrip(context, actor)) { releaseNextDelivery(context, actor); return; }
  // A trip can outlive its bay claim when a parked cart is still recovering; release only the
  // stale reservation and let the cart/cargo continue exactly where they are.
  if (actor.handcart) expireLayByClaims(context, actor.handcart);
  const progress = carrierClaimProgress(actor);
  updateHandcartCarrierStep(context, actor, dt);
  reconcileNextDelivery(context, actor);
  // Only movement/loading/unloading changes the lease; a blocked cart keeps its old deadline.
  refreshCarrierClaimOnProgress(context, actor, progress);
  refreshLayByClaimsOnProgress(context, actor, progress);
};

/** Carts of a storage plus the ones its carriers are using. */
export const handcartCount = (context: SettlementContext, uid: number) => {
  const storage = findBuilding(context, uid);
  return storage ? storageCartCount(context, storage) : 0;
};
