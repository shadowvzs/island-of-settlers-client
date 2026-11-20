import { DMath } from "../math/deterministic-math";
import { createNavalBackhaul, isReturningTransport, navalRouteLength, ordinaryTransportOrder, transportOrderNeed } from "./settlement-naval-backhaul";
import type { FleetBerthing } from "./settlement-naval-berthing";
import { reserveShipGoods } from "./settlement-naval-cargo-transfer";
import type {
  NavalColonyVoyage, NavalExpedition, NavalExploration, NavalHomewardLoad, NavalOrder, NavalPassengerHooks,
  NavalShip
} from "./settlement-naval-fleet";
import type { createShipRoutePlanner } from "./settlement-ship-routes";
import type { Goods, SettlementPoint } from "./settlement-types";
import { chooseNextTransportJob, chooseTransportForJob } from "./transport-reuse-policy";

const SHIP_CAPACITY = 40;

export interface NavalOrdersOptions {
  berthing: FleetBerthing;
  /** Sends a loaded (or turned back) ship on to where it unloads. */
  chooseUnload: (ship: NavalShip) => boolean;
  hooks?: NavalPassengerHooks;
  orders: NavalOrder[];
  planner: ReturnType<typeof createShipRoutePlanner>;
  /** The waiting spot where the ship is to be ferried at harbour `uid` (passengers by boat), or null. */
  ferrySpot: (uid: number, ship: NavalShip, load: Pick<NavalShip, "colony" | "expedition" | "passengers">,
    loading: boolean) => SettlementPoint | null;
  /** A ship stops loading: the boxes not aboard yet go back to its harbour's free stock. */
  releaseLoad: (ship: NavalShip) => void;
  ships: NavalShip[];
  remainingNeed?: (order: NavalOrder) => number | undefined;
  /** Hands out the next transport order id. */
  takeOrderId: () => number;
}

/**
 * Transport orders of the own fleet: queueing and cancelling loads, handing them to idle ships and
 * sending a ship to fetch an ended colony home. Created once per fleet.
 */
export const createNavalOrders = ({
  berthing, chooseUnload, ferrySpot, hooks, orders, planner, releaseLoad, remainingNeed, ships, takeOrderId
}: NavalOrdersOptions) => {
  const { accepting, anchorage, dock, harbor, queueAt, queuedNear, route, routeToBerth, seaExitAt } = berthing;
  const needFor = (order: NavalOrder) => remainingNeed?.(order) ?? transportOrderNeed(order);
  const routeDistance = (order: NavalOrder) => {
    const start = dock(order.sourceUid), end = dock(order.destinationUid);
    if (!start || !end || !accepting(order.destinationUid, order.cargo)) return Infinity;
    const points = planner.route({ ...start, yaw: start.yaw ?? 0 }, end);
    if (!points) return Infinity;
    return navalRouteLength(start, points);
  };
  const backhaul = createNavalBackhaul(ships, orders, { remainingNeed: needFor, routeDistance });
  const canQueue = (sourceUid: number, destinationUid: number, goods: Goods, passengers = 0,
    expedition?: NavalExpedition, exploration?: NavalExploration, colony?: NavalColonyVoyage) => {
    if (Object.values(goods).some((n) => !Number.isSafeInteger(n) || n < 0)) return false;
    const source = harbor(sourceUid), start = dock(sourceUid);
    const end = colony?.exit ?? expedition?.water ?? exploration?.points[exploration.cursor] ?? dock(destinationUid);
    const cargo = Object.fromEntries(Object.entries(goods).filter(([, count]) => count > 0));
    const count = Object.values(cargo).reduce((sum, value) => sum + value, 0) + passengers;
    const capacityExceeded = !colony && count > SHIP_CAPACITY;
    const roundTrip = sourceUid === destinationUid && !expedition && !exploration && !colony;
    if (!source || roundTrip || !start || !end || (!expedition && !colony && !accepting(destinationUid, cargo)) ||
      count < 1 || capacityExceeded || Object.values(cargo).some((n) => !Number.isSafeInteger(n)) ||
      !planner.route({ ...start, yaw: start.yaw ?? 0 }, end) ||
      Object.entries(cargo).some(([ware, n]) => (source.inventory[ware] ?? 0) < n)) return false;
    return true;
  };
  const queueTransport = (sourceUid: number, destinationUid: number, goods: Goods, passengers: number[] = [],
    expedition?: NavalExpedition, exploration?: NavalExploration, colony?: NavalColonyVoyage,
    reservedShipId?: number, demand?: Goods) => {
    if (!canQueue(sourceUid, destinationUid, goods, passengers.length, expedition, exploration, colony)) return null;
    const source = harbor(sourceUid)!;
    const cargo = Object.fromEntries(Object.entries(goods).filter(([, count]) => count > 0));
    // The wares stay in storage, reserved, until each box is carried aboard.
    reserveShipGoods(source, cargo);
    const id = takeOrderId();
    orders.push({ id, sourceUid, destinationUid, cargo, passengers, expedition, exploration, colony,
      shipId: reservedShipId, demand: demand && { ...demand },
      destinationPoolId: harbor(destinationUid)?.storagePoolId });
    backhaul.reconcile();
    return id;
  };
  /** A ship already under way with the order turns back to its harbour. */
  const recallShip = (id: number) => {
    const ship = ships.find(candidate =>
      candidate.orderId === id && candidate.phase !== "idle" && !candidate.cancelled);
    if (!ship || ship.sourceUid === undefined || ship.colony) return false;
    if (ship.foundingSiteUid !== undefined && hooks?.cancelFounding?.(ship) === false) return false;
    releaseLoad(ship);
    const next = orders.find(order => order.id === ship.nextOrderId);
    if (next) backhaul.release(next);
    ship.cancelled = true; ship.expedition = undefined; if (ship.exploration) ship.exploration.returning = true;
    ship.destinationUid = ship.sourceUid;
    chooseUnload(ship); return true;
  };
  /** Cancels a queued order (its reserved wares return to stock) or recalls the ship carrying it. */
  const cancelTransport = (id: number, releasePassengers = true) => {
    const index = orders.findIndex((order) => order.id === id);
    const order = orders[index];
    if (!order) return recallShip(id);
    const source = harbor(order.sourceUid); if (!source) return false;
    backhaul.release(order);
    reserveShipGoods(source, order.cargo, true);
    if (releasePassengers && order.passengers?.length) hooks?.release(order.passengers, source.uid);
    if (order.shipId !== undefined) {
      const ship = ships.find(candidate => candidate.id === order.shipId);
      if (ship) ship.reservedFor = undefined;
    }
    orders.splice(index, 1); return true;
  };
  const sendHomeward = (
    harbourUid: number, voyage: Pick<NavalColonyVoyage, "expeditionId" | "voyageSeconds">, load: NavalHomewardLoad
  ) => {
    const exit = harbor(harbourUid) && dock(harbourUid) &&
      seaExitAt(dock(harbourUid)!);
    const ship = exit && ships.find(entry => entry.phase === "idle" && !entry.visitor &&
      entry.reservedFor === undefined && entry.nextOrderId === undefined && planner.route(entry, exit));
    if (!exit || !ship) return null;
    ship.sourceUid = harbourUid; ship.destinationUid = harbourUid;
    ship.colony = { ...voyage, arrived: true, boxes: 0, exit, homeward: load };
    if (route(ship, exit, "sailing")) return ship.id;
    ship.colony = undefined; ship.sourceUid = undefined; ship.destinationUid = undefined;
    return null;
  };
  /**
   * The next load from a harbour: the ship sails to its berth, or while another ship holds the berth
   * to a waiting spot off it (it comes in as soon as the berth is free).
   */
  const startOrder = (ship: NavalShip, order: NavalOrder) => {
    // Passengers by boat: the ship lies at a waiting spot and the lighters ferry them (owner, 2026-10-21).
    const ferry = ferrySpot(order.sourceUid, ship, order, true);
    if (ferry && !route(ship, ferry, "positioning")) return false;
    const start = ferry ? null : dock(order.sourceUid, ship);
    if (start && !routeToBerth(ship, start, "positioning", order.sourceUid)) return false;
    if (ferry) ship.ferryAt = ferry;
    else if (!start) {
      // Only the first ship in the queue waits off a busy harbour; a loader stays where it is until then.
      if (queuedNear(order.sourceUid, ship)) return false;
      const spot = anchorage(order.sourceUid, ship);
      if (!spot || !route(ship, spot, "positioning")) return false;
      queueAt(ship, spot, false);
    }
    Object.assign(ship, { anchorage: undefined, cancelled: false, cargo: order.cargo, colony: order.colony,
      destinationPoolId: order.destinationPoolId, destinationUid: order.destinationUid, expedition: order.expedition, exploration: order.exploration,
      lastHarbourUid: undefined, orderId: order.id, passengers: order.passengers, sourceUid: order.sourceUid });
    ship.cargoCount = Object.values(ship.cargo).reduce((a, b) => a + b, 0) + (ship.passengers?.length ?? 0);
    return true;
  };
  /** Mandatory missions keep their hulls; ordinary next jobs rank real need before route length. */
  const assignOrders = (dt: number) => {
    backhaul.reconcile();
    const idle = ships.filter(ship => !ship.visitor && (ship.phase === "idle" || isReturningTransport(ship)));
    for (const ship of idle) if (ship.phase === "idle") ship.timer = Math.max(0, ship.timer - dt);
    let ready = idle.filter(ship => isReturningTransport(ship) || ship.timer <= 0);
    if (!ready.length) return;
    const ordinary = orders.filter(ordinaryTransportOrder).map(order => ({ order: order.id,
      remainingNeed: needFor(order), routeDistance: routeDistance(order), value: order }));
    const dispatch = orders.filter(order => !ordinaryTransportOrder(order));
    while (ordinary.length) {
      const next = chooseNextTransportJob(ordinary);
      if (!next) break;
      dispatch.push(next);
      ordinary.splice(ordinary.findIndex(entry => entry.value === next), 1);
    }
    for (const order of dispatch) {
      if (!ready.length) break;
      const berth = dock(order.sourceUid);
      if (order.shipId !== undefined &&
        !ships.some(ship => ship.id === order.shipId && ship.reservedFor !== undefined)) {
        // A lost reservation must not strand the load: release it back to normal assignment.
        delete order.shipId;
      }
      const eligible = ready.filter(ship => {
        if (order.shipId !== undefined) return ship.id === order.shipId;
        if (order.preferredShipId !== undefined) return ship.id === order.preferredShipId;
        return ship.reservedFor === undefined && ship.nextOrderId === undefined;
      });
      const candidates = berth ? eligible.flatMap(ship => {
        const pickup = planner.route(ship, berth);
        if (!pickup) return [];
        let routeCost = 0;
        let previous: SettlementPoint = ship;
        for (const point of pickup) {
          routeCost += DMath.hypot(point.x - previous.x, point.z - previous.z);
          previous = point;
        }
        return [{ atSource: ship.lastHarbourUid === order.sourceUid,
          availability: isReturningTransport(ship) ? "returning" as const : "idle" as const,
          id: ship.id, routeCost, value: ship }];
      }) : [];
      let taker: NavalShip | undefined;
      while (candidates.length) {
        const candidate = chooseTransportForJob(candidates);
        if (!candidate) break;
        if ((candidate.phase === "idle" || isReturningTransport(candidate)) && startOrder(candidate, order)) {
          taker = candidate; break;
        }
        candidates.splice(candidates.findIndex(entry => entry.value === candidate), 1);
      }
      if (!taker) continue;
      backhaul.release(order);
      if (order.shipId !== undefined) taker.reservedFor = undefined;
      orders.splice(orders.indexOf(order), 1);
      ready = ready.filter(ship => ship !== taker);
    }
    for (const ship of ready) if (ship.phase === "idle" && ship.reservedFor === undefined) ship.timer = .5;
  };
  return { assignOrders, canQueue, cancelTransport, queueTransport, sendHomeward };
};
