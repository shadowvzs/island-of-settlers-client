import { HANDCART_LOGISTICS } from "../balance/economy";
import { DMath } from "../math/deterministic-math";
import { isCatapultAmmoStock } from "./catapult-ammo-kinds";
import { depositCatapultGroundStone } from "./military-catapult-resupply";
import { addGood, STORAGE_IDS } from "./production-rules";
import { releaseLayByClaims } from "./settlement-carrier-laybys";
import { findHomeBuilding } from "./settlement-home";
import { actorEconomyOwnerOf, PLAYER_FACTION, servesEconomyOf } from "./settlement-ownership";
import type {
  SettlementActor,
  SettlementBuilding,
  SettlementContext,
  SettlementHandcart,
  SettlementHandcartTrip,
  SettlementPoint
} from "./settlement-types";

/**
 * Hand-cart stock accounting. Every item is in exactly one place: source stock (or the
 * prepaid ledger of a storage source), the cart bed, the carrier's hands, or a destination.
 */
export const findBuilding = (context: SettlementContext, uid: number | undefined) =>
  uid === undefined ? undefined : context.buildings.find((building) => building.uid === uid);

export const isCompletedStorage = (building: SettlementBuilding) =>
  building.construction === 1 && STORAGE_IDS.has(building.typeId);

/** Goods a building receives: a storage's inventory, otherwise its input (or construction) stock. */
const receivingStock = (building: SettlementBuilding) =>
  isCompletedStorage(building) ? building.inventory : building.input;

/** Output of production sources still promised to carts (storage sources are prepaid). */
export const handcartReservedOutput = (context: SettlementContext, source: number, ware: string) => {
  let reserved = 0;
  for (const actor of context.actors) {
    const trip = actor.handcart?.trip;
    if (trip?.source === source && trip.ware === ware) reserved += trip.planned - trip.loaded - trip.prepaid;
  }
  return reserved;
};

/** Moves one item from the source onto the bed; false when the source has nothing left. */
export const loadOneItem = (context: SettlementContext, cart: SettlementHandcart) => {
  const trip = cart.trip!;
  if (trip.prepaid > 0) {
    trip.prepaid--;
  } else {
    const source = findBuilding(context, trip.source);
    if (!source || !(source.output[trip.ware] ?? 0)) return false;
    addGood(source.output, trip.ware, -1);
  }
  trip.loaded++;
  cart.cargo++;
  return true;
};

/** Hands one item to a building; the trip destination also clears one `incoming` promise. */
export const depositOneItem = (
  context: SettlementContext,
  trip: SettlementHandcartTrip,
  building: SettlementBuilding
) => {
  if (isCatapultAmmoStock(building, trip.ware)) {
    if (!depositCatapultGroundStone(building, 1, trip.ware)) return false;
  } else addGood(receivingStock(building), trip.ware);
  if (building.uid === trip.destination) addGood(building.incoming, trip.ware, -1);
  trip.delivered++;
  return true;
};

/** Returns prepaid items to their storage (or, once it is gone, to the headquarters' salvage). */
const refundPrepaid = (context: SettlementContext, trip: SettlementHandcartTrip) => {
  if (trip.prepaid <= 0) return;
  const source = findBuilding(context, trip.source) ?? findHomeBuilding(context);
  if (source) addGood(source.inventory, trip.ware, trip.prepaid);
  trip.prepaid = 0;
};

/** Stops loading: unloaded reservations and prepaid stock are released, real cargo stays. */
export const closeLoading = (context: SettlementContext, trip: SettlementHandcartTrip) => {
  refundPrepaid(context, trip);
  const unfilled = trip.planned - trip.loaded;
  if (unfilled <= 0) return;
  const destination = findBuilding(context, trip.destination);
  if (destination) addGood(destination.incoming, trip.ware, -unfilled);
  trip.planned = trip.loaded;
};

/** The destination no longer expects this cart; remaining cargo will be salvaged elsewhere. */
export const releaseDestination = (context: SettlementContext, trip: SettlementHandcartTrip) => {
  closeLoading(context, trip);
  const destination = findBuilding(context, trip.destination);
  const outstanding = trip.planned - trip.delivered;
  if (destination && outstanding > 0) addGood(destination.incoming, trip.ware, -outstanding);
  trip.destination = undefined;
};

/** Points the trip at a new destination that now expects every remaining item. */
export const retargetTrip = (
  trip: SettlementHandcartTrip,
  destination: SettlementBuilding,
  remaining: number
) => {
  trip.destination = destination.uid;
  trip.planned = trip.delivered + remaining;
  addGood(destination.incoming, trip.ware, remaining);
};

/** A trip that never loaded anything simply ends: reservations and prepaid stock are released. */
export const cancelEmptyTrip = (context: SettlementContext, cart: SettlementHandcart) => {
  const trip = cart.trip;
  if (!trip) return;
  releaseDestination(context, trip);
  releaseLayByClaims(cart);
  cart.trip = undefined;
};

/**
 * Carts a storage owns: on its shelf, out with carriers (`except` is left out of the count) and
 * standing abandoned where their crew was lost.
 */
export const storageCartCount = (
  context: Pick<SettlementContext, "abandonedHandcarts" | "actors">, storage: SettlementBuilding,
  except?: SettlementActor
) => {
  let count = storage.handcarts ?? 0;
  for (const actor of context.actors) if (actor !== except && actor.handcart?.owner === storage.uid) count++;
  for (const cart of context.abandonedHandcarts ?? []) if (cart.owner === storage.uid) count++;
  return count;
};

export const hasCartRoom = (context: SettlementContext, storage: SettlementBuilding, except?: SettlementActor) =>
  storageCartCount(context, storage, except) < HANDCART_LOGISTICS.storageLimit;

/** A finished storage that may keep one more cart (an already owned cart always fits). */
export const canAdoptCart = (context: SettlementContext, building: SettlementBuilding, actor?: SettlementActor) =>
  isCompletedStorage(building) && (actor?.handcart?.owner === building.uid || hasCartRoom(context, building, actor));

/** The nearest finished storage that can take one more cart, if any. */
export const nearestStorageWithCartRoom = (
  context: SettlementContext,
  point: SettlementPoint,
  except?: SettlementActor
) => {
  let best: { distance: number; storage: SettlementBuilding } | undefined;
  const owner = except ? actorEconomyOwnerOf(context, except) : PLAYER_FACTION;
  for (const storage of context.buildings) {
    if (!isCompletedStorage(storage) || !servesEconomyOf(context, storage, owner) ||
      !hasCartRoom(context, storage, except)) continue;
    const distance = DMath.hypot(storage.access.x - point.x, storage.access.z - point.z);
    if (!best || distance < best.distance) best = { distance, storage };
  }
  return best?.storage;
};

/** A cart with no storage to keep it is taken apart: its build cost goes back into stock. */
export const refundHandcarts = (storage: SettlementBuilding, carts: number) => {
  for (const [ware, count] of Object.entries(HANDCART_LOGISTICS.cost)) addGood(storage.inventory, ware, count * carts);
};

/** Shelves carts at a storage up to its limit; the rest are dismantled into its stock. */
export const shelveHandcarts = (
  context: SettlementContext,
  storage: SettlementBuilding,
  carts: number,
  except?: SettlementActor
) => {
  const room = Math.max(0, HANDCART_LOGISTICS.storageLimit - storageCartCount(context, storage, except));
  const kept = Math.min(room, carts);
  storage.handcarts = (storage.handcarts ?? 0) + kept;
  refundHandcarts(storage, carts - kept);
};

/** Old saves may hold more carts than a storage may keep: the extras are dismantled. */
export const clampStorageHandcarts = (context: SettlementContext) => {
  for (const storage of context.buildings) {
    const extra = Math.min(storage.handcarts ?? 0,
      storageCartCount(context, storage) - HANDCART_LOGISTICS.storageLimit);
    if (extra <= 0) continue;
    storage.handcarts! -= extra;
    refundHandcarts(storage, extra);
  }
};

/** The cart goes back on its storage's shelf; the carrier becomes an ordinary returning carrier. */
export const storeHandcart = (context: SettlementContext, actor: SettlementActor, storage: SettlementBuilding) => {
  shelveHandcarts(context, storage, 1, actor);
  releaseLayByClaims(actor.handcart!);
  actor.handcart = undefined;
  actor.home = storage.uid;
  actor.building = storage.uid;
  actor.locomotionSpeed = undefined;
};
