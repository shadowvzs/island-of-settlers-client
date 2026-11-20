import { DMath } from "../math/deterministic-math";
import { addGood } from "./production-rules";
import { releaseDeliveryClaim } from "./settlement-carrier-claims";
import { releaseLayByClaims } from "./settlement-carrier-laybys";
import { releaseCorridor } from "./settlement-corridor-reservations";
import { findBuilding, isCompletedStorage, releaseDestination, storeHandcart } from "./settlement-handcart-ledger";
import { isOwnBuilding } from "./settlement-home";
import { releaseNextDelivery } from "./settlement-land-transport-claims";
import { addIdleSettlers, retirePerson } from "./settlement-population";
import { bumpNavigationRevision } from "./settlement-reservations";
import { clearTrafficBlocker } from "./settlement-traffic-deadlock";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";

/** What one development-menu reset moved. */
export interface DebugResetLogisticsReport {
  /** Carriers returned to a storage and made available as idle settlers. */
  carriers: number;
  /** Distinct completed storages that received people or ware. */
  storages: number;
  /** Ware units moved from hands, cart beds or demolition cargo into storage stock. */
  ware: number;
}

const isFriendlyStorage = (building: SettlementBuilding) =>
  isCompletedStorage(building) && isOwnBuilding(building);

/**
 * The closest completed storage to an actor. Prefer one that accepts the actor's carried ware,
 * but a full/storage-policy mismatch must never strand the debug reset; fall back to any storage.
 */
const nearestStorageFor = (
  context: SettlementContext, actor: SettlementActor, ware?: string | null
) => {
  const storages = context.buildings.filter(isFriendlyStorage);
  const accepting = ware === undefined || ware === null ? storages
    : storages.filter(storage => storage.accepts[ware] !== false);
  const candidates = accepting.length ? accepting : storages;
  let nearest: SettlementBuilding | undefined;
  let nearestDistance = Infinity;
  for (const storage of candidates) {
    const distance = DMath.hypot(storage.access.x - actor.x, storage.access.z - actor.z);
    if (distance < nearestDistance || (distance === nearestDistance && storage.uid < (nearest?.uid ?? Infinity))) {
      nearest = storage;
      nearestDistance = distance;
    }
  }
  return nearest;
};

/** Adds carried units to a storage without applying the normal storage-capacity rejection. */
const deposit = (
  building: SettlementBuilding, ware: string | null | undefined, units: number | undefined,
  report: DebugResetLogisticsReport
) => {
  const count = Math.max(0, Math.floor(units ?? 1));
  if (!ware || count < 1) return;
  addGood(building.inventory, ware, count);
  report.ware += count;
};

/** Releases a carrier destination claim and prepaid source stock, keeping real cargo. */
const releaseClaims = (context: SettlementContext, actor: SettlementActor) => {
  releaseNextDelivery(context, actor);
  if (actor.delivery) releaseDeliveryClaim(context, actor);
};

const clearCarrierMovement = (actor: SettlementActor) => {
  actor.action = "idle";
  actor.path = [];
  actor.pathIndex = 0;
  actor.queueTarget = undefined;
  actor.queueWait = 0;
  actor.queueKind = undefined;
  actor.productionPath = undefined;
  actor.productionOutput = undefined;
  actor.productionSeconds = undefined;
  actor.productionInputs = undefined;
  actor.afterInputPhase = undefined;
  actor.preparedTarget = undefined;
  actor.target = undefined;
  actor.timer = 0;
  actor.navigationRecovery = undefined;
  actor.navigationReturnCargo = undefined;
  actor.workerMovementPlan = undefined;
  actor.workerHandlingPlan = undefined;
  actor.stockContact = undefined;
  actor.stockBuilding = undefined;
  actor.storageArrivalOrder = undefined;
  actor.storageArrivalBuilding = undefined;
  actor.wareTransfer = undefined;
  actor.wareScale = undefined;
  actor.demolitionReturning = undefined;
  actor.demolitionCargo = undefined;
  actor.fieldWork = undefined;
  actor.sowingBatch = undefined;
  actor.wellWork = undefined;
  actor.foresterSeedling = undefined;
  actor.treeFellingStarted = undefined;
  actor.huntArrow = undefined;
  actor.boatWork = undefined;
  actor.navalOrder = undefined;
  actor.locomotionSpeed = undefined;
};

/** Stores a carrier actor and returns one idle settler at that storage. */
const storeCarrier = (
  context: SettlementContext, actor: SettlementActor, storage: SettlementBuilding,
  report: DebugResetLogisticsReport
) => {
  const home = findBuilding(context, actor.home);
  if (home?.worker === actor.uid) home.worker = undefined;

  // A cart's real bed cargo survives; its unloaded destination promises and prepaid source stock
  // are released with the trip, so the deposit below cannot double-count them.
  const cart = actor.handcart;
  const trip = cart?.trip;
  if (trip) {
    releaseDestination(context, trip);
    deposit(storage, trip.ware, cart!.cargo, report);
    cart!.cargo = 0;
  }
  if (cart && cart.state !== "stored") storeHandcart(context, actor, storage);
  else if (cart) {
    releaseLayByClaims(cart);
    actor.handcart = undefined;
  }

  releaseClaims(context, actor);
  deposit(storage, actor.ware, actor.wareUnits, report);
  actor.ware = null;
  actor.wareUnits = undefined;

  // Demolition and production transfers are not normal carrier cargo, but never discard them.
  for (const [ware, units] of Object.entries(actor.demolitionCargo ?? {}))
    deposit(storage, ware, units, report);
  for (const [ware, units] of Object.entries(actor.consumed ?? {}))
    deposit(storage, ware, units, report);
  if (actor.tool) deposit(storage, actor.tool, 1, report);
  actor.tool = undefined;
  actor.consumed = undefined;

  clearCarrierMovement(actor);
  releaseCorridor(context, actor.uid);
  clearTrafficBlocker(actor);

  actor.job = "Settler";
  retirePerson(context, actor);
  actor.visible = false;
  actor.x = storage.doorThreshold.x;
  actor.z = storage.doorThreshold.z;
  actor.y = storage.y;
  actor.home = storage.uid;
  actor.building = storage.uid;
  addIdleSettlers(context, storage);
  report.carriers++;
};

/**
 * Development menu: instantly reset carrier logistics. Every land carrier is moved into its nearest
 * completed storage; carried ware and cart-bed cargo become storage stock. Carriers committed to a
 * naval order stay where they are.
 */
export const resetCarriers = (context: SettlementContext): DebugResetLogisticsReport => {
  const report: DebugResetLogisticsReport = { carriers: 0, storages: 0, ware: 0 };
  const used = new Set<number>();

  for (const actor of context.actors) {
    if (actor.phase === "retired" || actor.navalOrder !== undefined || actor.boatWork !== undefined) continue;
    // A full-time building employee is not a storage logistics crew, even while idle indoors.
    if (actor.catapultEvacuation || context.buildings.some(building => building.worker === actor.uid)) continue;
    if (actor.job !== "Carrier") continue;
    const ware = actor.handcart?.trip?.ware ?? actor.delivery?.ware ?? actor.ware;
    const storage = nearestStorageFor(context, actor, ware);
    if (!storage) continue;
    storeCarrier(context, actor, storage, report);
    used.add(storage.uid);
  }

  if (report.carriers) bumpNavigationRevision(context);
  report.storages = used.size;
  return report;
};
