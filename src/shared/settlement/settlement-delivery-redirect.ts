import { DMath } from "../math/deterministic-math";
import { addGood, STORAGE_IDS } from "./production-rules";
import { releaseLayByClaims } from "./settlement-carrier-laybys";
import { leaveStorageArrival } from "./settlement-door-traffic";
import { exitPath } from "./settlement-entrance";
import { isCompletedStorage, releaseDestination, retargetTrip } from "./settlement-handcart-ledger";
import { salvageByCart } from "./settlement-handcart-moves";
import { redirectHandcartRecoveryDelivery } from "./settlement-handcart-recovery";
import { footRouteFrom, stoneRouteFrom } from "./settlement-handcart-roads";
import { releaseNextDelivery } from "./settlement-land-transport-claims";
import { nearestStorage } from "./settlement-logistics";
import { groundPath, setActorPath } from "./settlement-paths";
import { clearWareTransfer } from "./settlement-stock-transfers";
import type { SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

const nearestStoneStorage = (
  context: SettlementContext,
  from: SettlementPoint,
  disabledUid: number,
  ware: string
) => {
  const storages = context.buildings
    .filter(building => building.uid !== disabledUid && isCompletedStorage(building) &&
      building.accepts[ware] !== false)
    .sort((left, right) =>
      DMath.hypot(left.access.x - from.x, left.access.z - from.z) -
        DMath.hypot(right.access.x - from.x, right.access.z - from.z) || left.uid - right.uid);
  for (const storage of storages) {
    if (stoneRouteFrom(context, from, storage.access)) return storage;
  }
  return undefined;
};

const rerouteCarrierPath = (
  context: SettlementContext,
  actor: SettlementActor,
  disabled: SettlementBuilding,
  next: SettlementBuilding,
  source: SettlementBuilding | undefined
) => {
  // A carrier leaving its source must first clear that building's own door/courtyard. The source
  // can be the disabled destination only when the delivery is returning there, never on pickup.
  if (source && (actor.phase === "exitLoaded" || actor.phase === "pickupTransfer")) {
    const local = groundPath(context, actor, source.access, source.uid);
    const route = context.options.roads.route(source.access, next.access);
    if (local && route) return [...local, ...route.points];
    if (route) return [...exitPath(source), ...route.points];
  }
  const direct = footRouteFrom(context, actor, next.access);
  if (direct) return direct;
  // A carrier can be mid-door when the policy changes. Leave the disabled storage over its own
  // door path before joining the road; its cargo stays in hand throughout.
  const route = context.options.roads.route(disabled.access, next.access);
  return route ? [...exitPath(disabled), ...route.points] : null;
};

/**
 * Re-point a loaded hand cart at the nearest stone-connected storage that still accepts its ware.
 * The alternative is found before the old promise is released, so a cart with no receiver keeps its
 * original committed destination instead of being parked without one.
 */
const redirectHandcart = (
  context: SettlementContext,
  actor: SettlementActor,
  disabledUid: number,
  ware: string
): boolean => {
  const cart = actor.handcart!;
  const trip = cart.trip!;
  const remaining = trip.planned - trip.delivered;
  if (remaining <= 0) return false;
  const from = trip.source === undefined ? actor : context.buildings.find(building =>
    building.uid === trip.source)?.access ?? actor;
  const next = nearestStoneStorage(context, from, disabledUid, ware);
  if (!next) return false;
  if (cart.cargo > 0) {
    // The loaded cart leaves the source bay now; salvageByCart chooses its stone route and keeps
    // the cargo on the bed. The old destination promise is released first so no incoming is lost.
    releaseDestination(context, trip);
    releaseLayByClaims(cart, "source");
    salvageByCart(context, actor);
    actor.building = trip.destination ?? actor.building;
    return true;
  }
  // Nothing is loaded yet: keep the same trip/source and point its planned load at the new receiver.
  // The source bay stays held until the normal loaded departure releases it.
  releaseDestination(context, trip);
  retargetTrip(trip, next, remaining);
  actor.building = next.uid;
  return true;
};

/**
 * A storage's receiving switch changes future demand, but cargo already promised to that storage
 * must not keep walking into a disabled door. Re-point carriers, mounts and hand carts at the
 * nearest road-connected storage that accepts the ware, moving the incoming reservation with them.
 * Their cargo never changes owner and no new stock is created.
 */
export const redirectStorageDeliveries = (
  context: SettlementContext,
  disabledUid: number,
  ware: string
) => {
  const disabled = context.buildings.find(building => building.uid === disabledUid);
  if (!disabled || disabled.construction !== 1 || !STORAGE_IDS.has(disabled.typeId)) return 0;
  let redirected = 0;
  for (const actor of context.actors) if (actor.nextDelivery &&
    ((actor.nextDelivery.destination === disabledUid && actor.nextDelivery.ware === ware) ||
      actor.delivery?.destination === disabledUid || actor.handcart?.trip?.destination === disabledUid))
    releaseNextDelivery(context, actor);

  for (const actor of context.actors) {
    const cart = actor.handcart, trip = cart?.trip;
    if (!cart || !trip || trip.ware !== ware) continue;
    if (trip.destination !== disabledUid && cart.shuttleTarget !== disabledUid) continue;
    if (actor.phase === "cartRecover" || actor.phase === "cartShuttleOut" ||
      actor.phase === "cartShuttleBack" || cart.shuttleTarget !== undefined) {
      if (redirectHandcartRecoveryDelivery(context, actor, disabledUid, ware)) redirected++;
      continue;
    }
    if (redirectHandcart(context, actor, disabledUid, ware)) redirected++;
  }

  for (const actor of context.actors) {
    const delivery = actor.delivery;
    if (!delivery || delivery.destination !== disabledUid || delivery.ware !== ware) continue;
    // Workshop-upgrade loads have a fixed authoritative recipient; moving them to another warehouse
    // would break the contract that dispatched them.
    if (delivery.upgrade) continue;
    const next = nearestStorage(context, disabled, undefined, ware)?.building;
    if (!next || next.uid === disabledUid) continue;
    const units = actor.wareUnits ?? 1;
    addGood(disabled.incoming, ware, -units);
    addGood(next.incoming, ware, units);
    delivery.destination = next.uid;
    actor.building = next.uid;
    redirected++;
    actor.workerMovementPlan = undefined;
    actor.workerHandlingPlan = undefined;
    actor.navigationRecovery = undefined;
    leaveStorageArrival(context, actor);
    // A carrier still loading at its source keeps that source path; its next loaded leg uses the
    // new destination. A carrier already carrying the ware is re-planned from its actual position.
    if (actor.ware !== ware) continue;
    const inside = [
      "deliveryStockWalk", "deliveryTransfer", "enterDelivery", "pickupTransfer"
    ].includes(actor.phase);
    if (inside) {
      clearWareTransfer(actor);
      actor.stockContact = undefined;
      actor.stockBuilding = undefined;
    }
    const source = context.buildings.find(building => building.uid === delivery.source);
    const path = rerouteCarrierPath(context, actor, disabled, next, source);
    if (!path) {
      actor.phase = "carrierDeliveryBlocked";
      actor.action = "idle";
      actor.timer = 1;
      continue;
    }
    setActorPath(actor, path, "deliver");
  }
  return redirected;
};
