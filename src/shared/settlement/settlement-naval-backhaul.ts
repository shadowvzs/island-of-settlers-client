import { DMath } from "../math/deterministic-math";
import type { NavalOrder, NavalShip } from "./settlement-naval-fleet";
import type { SettlementPoint } from "./settlement-types";
import { chooseNextTransportJob, chooseTransportForJob } from "./transport-reuse-policy";

/** Only ordinary own deliveries can promise their hull after the current unload. */
export const canBackhaul = (ship: NavalShip, sourceUid: number) =>
  ship.phase === "unloading" && ship.destinationUid === sourceUid && !ship.visitor && !ship.troopMission &&
  !ship.cancelled && !ship.colony && !ship.expedition && !ship.exploration && ship.foundingSiteUid === undefined &&
  ship.reservedFor === undefined;

export const ordinaryTransportOrder = (order: NavalOrder) => order.shipId === undefined &&
  !order.colony && !order.expedition && !order.exploration &&
  Object.values(order.cargo).reduce((sum, count) => sum + count, 0) + (order.passengers?.length ?? 0) <= 40;

/** A completed delivery's empty voyage to a parking spot has no remaining transport commitment. */
export const isReturningTransport = (ship: NavalShip) => ship.phase === "sailing" &&
  ship.anchorage !== undefined && !ship.visitor && ship.orderId === undefined &&
  !ship.colony && !ship.expedition && !ship.exploration && ship.foundingSiteUid === undefined &&
  !ship.passengers?.length && !ship.troops?.length && !Object.values(ship.cargo).some(count => count > 0);

const emptyOwnHull = (ship: NavalShip) => ship.phase === "idle" && !ship.visitor &&
  !ship.colony && !ship.expedition && !ship.exploration && ship.foundingSiteUid === undefined &&
  ship.reservedFor === undefined && ship.orderId === undefined && !ship.passengers?.length &&
  !ship.troops?.length && !Object.values(ship.cargo).some(count => count > 0);

/** A reservation is a saved promise, never a second cargo or crew owner. */
export const navalRouteLength = (from: SettlementPoint, route: readonly SettlementPoint[]) => {
  let distance = 0, previous = from;
  for (const point of route) {
    distance += DMath.hypot(point.x - previous.x, point.z - previous.z); previous = point;
  }
  return distance;
};

export const transportOrderNeed = (order: NavalOrder) =>
  Object.values(order.demand ?? order.cargo).reduce((sum, count) => sum + count, 0) +
  (order.passengers?.length ?? 0);

interface BackhaulPriority {
  remainingNeed?: (order: NavalOrder) => number;
  routeDistance?: (order: NavalOrder, ship: NavalShip) => number;
}

export const createNavalBackhaul = (ships: NavalShip[], orders: NavalOrder[], priority: BackhaulPriority = {}) => {
  const release = (order: NavalOrder) => {
    const ship = ships.find(candidate => candidate.id === order.preferredShipId);
    if (ship?.nextOrderId === order.id) delete ship.nextOrderId;
    delete order.preferredShipId;
  };
  const reconcile = () => {
    for (const order of orders) {
      if (order.preferredShipId === undefined) continue;
      const ship = ships.find(candidate => candidate.id === order.preferredShipId);
      const ready = ship && emptyOwnHull(ship);
      if (!ship || ship.nextOrderId !== order.id || !ordinaryTransportOrder(order) ||
        (!ready && !canBackhaul(ship, order.sourceUid))) release(order);
    }
    for (const ship of ships) if (ship.nextOrderId !== undefined &&
      !orders.some(order => order.id === ship.nextOrderId && order.preferredShipId === ship.id))
      delete ship.nextOrderId;
    // Reconsider only unstarted promises; current voyage/passenger manifests remain untouched.
    const idleSources = new Map<number, number>();
    for (const order of orders) {
      const ship = ships.find(candidate => candidate.id === order.preferredShipId);
      if (ship && (canBackhaul(ship, order.sourceUid) || emptyOwnHull(ship))) {
        if (emptyOwnHull(ship)) idleSources.set(ship.id, order.sourceUid);
        release(order);
      }
    }
    const local = ships.filter(ship => ship.nextOrderId === undefined &&
      (ship.destinationUid !== undefined && canBackhaul(ship, ship.destinationUid) ||
        emptyOwnHull(ship) && (ship.lastHarbourUid !== undefined || idleSources.has(ship.id))));
    const units = local.map(ship => ({ atSource: true, availability: ship.phase === "idle" ?
      "idle" as const : "unloading" as const, id: ship.id, routeCost: 0, value: ship }));
    while (units.length) {
      const ship = chooseTransportForJob(units)!;
      units.splice(units.findIndex(entry => entry.value === ship), 1);
      const sourceUid = ship.phase === "idle" ? ship.lastHarbourUid ?? idleSources.get(ship.id) : ship.destinationUid;
      const candidates = orders.filter(order => ordinaryTransportOrder(order) &&
        order.preferredShipId === undefined && order.sourceUid === sourceUid).map(order => ({
          order: order.id, remainingNeed: priority.remainingNeed?.(order) ?? transportOrderNeed(order),
          routeDistance: priority.routeDistance?.(order, ship) ?? 0, value: order }));
      const order = chooseNextTransportJob(candidates);
      if (!order) continue;
      order.preferredShipId = ship.id;
      ship.nextOrderId = order.id;
    }
  };
  return { reconcile, release };
};

/** Check both ends before restoring a promise; UID zero remains valid for harbour access. */
export const validNavalBackhaul = (ships: readonly NavalShip[], orders: readonly NavalOrder[]) => {
  const claimed = new Set<number>();
  for (const order of orders) {
    if (order.preferredShipId === undefined) continue;
    const ship = ships.find(candidate => candidate.id === order.preferredShipId);
    if (!Number.isSafeInteger(order.preferredShipId) || order.preferredShipId < 1 ||
      !ship || claimed.has(ship.id) || ship.nextOrderId !== order.id || !ordinaryTransportOrder(order) ||
      (!emptyOwnHull(ship) && !canBackhaul(ship, order.sourceUid)) || ship.visitor ||
      ship.reservedFor !== undefined) return false;
    claimed.add(ship.id);
  }
  return ships.every(ship => ship.nextOrderId === undefined ||
    Number.isSafeInteger(ship.nextOrderId) && ship.nextOrderId >= 1 && orders.some(order =>
      order.id === ship.nextOrderId && order.preferredShipId === ship.id));
};
