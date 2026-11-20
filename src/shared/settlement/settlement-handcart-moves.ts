import {
  CART_STONE_LANE,
  cartCentreBehind
} from "../../render-common/logistics/handcart-rules";
import { DMath } from "../math/deterministic-math";
import { releaseLayByClaims } from "./settlement-carrier-laybys";
import { canPullCartAcrossStorageApron } from "./settlement-handcart-apron";
import {
  findBuilding,
  hasCartRoom,
  isCompletedStorage,
  retargetTrip,
  storeHandcart
} from "./settlement-handcart-ledger";
import { stoneRouteFrom } from "./settlement-handcart-roads";
import { roadRevisionSinceLoad } from "./settlement-load-revisions";
import { setActorPath } from "./settlement-paths";
import { prepareRoadPath } from "./settlement-road-travel";
import type {
  SettlementActor,
  SettlementBuilding,
  SettlementContext,
  SettlementPoint
} from "./settlement-types";

/** Retry interval of a cart (or its carrier) waiting for a route. */
export const HANDCART_RETRY_SECONDS = 1;

/** A cart follows the 0.8 dirt road's centre and keeps right on 1.2 stone roads, so carts pass. */
export const setCartPath = (
  context: SettlementContext,
  actor: SettlementActor,
  points: SettlementPoint[],
  phase: string
) => {
  setActorPath(actor, points, phase);
  prepareRoadPath(context, actor, 0, CART_STONE_LANE);
  actor.handcart!.roadRevision = roadRevisionSinceLoad(context);
};

export const hitchCart = (actor: SettlementActor) => {
  const cart = actor.handcart!;
  if (cart.state === "parked" && cart.parked) actor.yaw = cart.parked.yaw;
  cart.state = "hitched";
  cart.parked = undefined;
};

/** Leaves the cart standing where it is; its cargo stays on the bed until a carrier moves it. */
export const parkCart = (actor: SettlementActor) => {
  const cart = actor.handcart!;
  if (cart.state === "hitched") {
    cart.parked = { ...cartCentreBehind(actor.x, actor.z, actor.yaw), yaw: actor.yaw };
    cart.state = "parked";
  }
  actor.path = [];
  actor.pathIndex = 0;
  actor.queueTarget = undefined;
  actor.action = "idle";
  actor.phase = "cartRecover";
  actor.timer = 0;
};

/** Puts the cart away and lets the ordinary carrier logic walk the puller in through the door. */
const shelveAt = (context: SettlementContext, actor: SettlementActor, storage: SettlementBuilding) => {
  storeHandcart(context, actor, storage);
  setActorPath(actor, [], "home");
};

const storagesNearest = (context: SettlementContext, actor: SettlementActor, preferred?: number) =>
  context.buildings.filter(isCompletedStorage).sort((a, b) =>
    Number(b.uid === preferred) - Number(a.uid === preferred) ||
    DMath.hypot(a.access.x - actor.x, a.access.z - actor.z) -
      DMath.hypot(b.access.x - actor.x, b.access.z - actor.z) || a.uid - b.uid);

/**
 * A returning cart that stops on the storage's access apron (a queue or lane offset) is home: it
 * must not park there and wait for a stone route it cannot get from beside the door, blocking
 * the entrance for every carrier and led horse (HQ jam, owner save 2026-10-20 (5)).
 */
const SHELVING_REACH = .75;
const isAtStorage = (actor: SettlementActor, storage: SettlementBuilding) =>
  DMath.hypot(actor.x - storage.access.x, actor.z - storage.access.z) < SHELVING_REACH;

/** A cart keeps its home storage; another storage only adopts it while it has room for one more. */
const returnStorages = (context: SettlementContext, actor: SettlementActor) => {
  const owner = actor.handcart!.owner;
  return storagesNearest(context, actor, owner).filter(storage =>
    storage.uid === owner || hasCartRoom(context, storage, actor));
};

/** Empty carts travel over stone; a parked cart beside storage may cross its clear local apron. */
export const startCartReturn = (context: SettlementContext, actor: SettlementActor) => {
  const cart = actor.handcart!;
  // Leaving a flag/trip releases every bay it still held; a return never carries occupancy home.
  releaseLayByClaims(cart);
  cart.trip = undefined;
  const storages = returnStorages(context, actor);
  for (const storage of storages) {
    if (isAtStorage(actor, storage)) {
      shelveAt(context, actor, storage);
      return true;
    }
    const route = stoneRouteFrom(context, actor, storage.access);
    if (!route && !canPullCartAcrossStorageApron(context, actor, storage)) continue;
    beginReturn(context, actor, storage, route?.points ?? [storage.access]);
    return true;
  }
  return false;
};

const beginReturn = (
  context: SettlementContext,
  actor: SettlementActor,
  storage: SettlementBuilding,
  points: SettlementPoint[]
) => {
  const cart = actor.handcart!;
  cart.owner = storage.uid;
  actor.home = storage.uid;
  actor.building = storage.uid;
  hitchCart(actor);
  setCartPath(context, actor, points, "cartReturn");
};

/** Arrival of a returning cart at its storage. */
export const finishCartReturn = (context: SettlementContext, actor: SettlementActor) => {
  const storage = findBuilding(context, actor.handcart!.owner);
  if (storage && isCompletedStorage(storage) && isAtStorage(actor, storage)) return shelveAt(context, actor, storage);
  if (!startCartReturn(context, actor)) parkCart(actor);
};

/** A loaded cart heads for its destination over stone; otherwise it is parked and unloaded by hand. */
export const departLoaded = (context: SettlementContext, actor: SettlementActor) => {
  // The loaded cart leaves the source bay now, whether or not the destination leg is still open.
  releaseLayByClaims(actor.handcart!, "source");
  const trip = actor.handcart!.trip!;
  const destination = findBuilding(context, trip.destination);
  const route = destination && stoneRouteFrom(context, actor, destination.access);
  if (!route) return parkCart(actor);
  actor.building = destination.uid;
  setCartPath(context, actor, route.points, "cartToDestination");
};

/** The destination is gone: the loaded cart takes its cargo to the nearest storage reachable over stone. */
export const salvageByCart = (context: SettlementContext, actor: SettlementActor) => {
  const cart = actor.handcart!;
  // The old destination promise dies with the flag; salvage may not reserve a new bay before it
  // knows which storage can actually take the cargo. The goods stay on the bed until then.
  releaseLayByClaims(cart, "destination");
  const trip = cart.trip!;
  for (const storage of storagesNearest(context, actor)) {
    if (storage.accepts[trip.ware] === false) continue;
    const route = stoneRouteFrom(context, actor, storage.access);
    if (!route) continue;
    retargetTrip(trip, storage, cart.cargo);
    actor.building = storage.uid;
    setCartPath(context, actor, route.points, "cartToDestination");
    return;
  }
  parkCart(actor);
};
