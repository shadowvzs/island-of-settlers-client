import { shipDeckCapacity } from "@shared/catalog";

import { DMath } from "../math/deterministic-math";
import { colonyUpgradeReserve } from "./colony-advanced-material-trade";
import type { EmigratedTroop } from "./settlement-military";
import type { FleetBerthing } from "./settlement-naval-berthing";
import type {
  NavalPassengerHooks, NavalShip, NavalVisitor, NavalVisitorRole
} from "./settlement-naval-fleet";
import { planHandling } from "./settlement-naval-ship-handling";
import { isTradeShip, type TradeVisitor } from "./settlement-naval-trade";
import { reliefShipOutsideMap, sailReliefOffMap } from "./settlement-relief-departure";
import { ANCHORAGE_SPACING } from "./settlement-ship-anchorage";
import { SHIP_SPEED } from "./settlement-ship-kinematics";
import type { createShipRoutePlanner, ShipDestination } from "./settlement-ship-routes";
import { initialRouteHeading } from "./settlement-ship-steering";
import type { Goods, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";
import { boxesFor, wareBoxUnits } from "./ship-cargo-boxes";

/** One full sailing-ship deck (catalog `ship:sailingShip` capacity). */
const { boxes: SHIP_DECK_BOXES } = shipDeckCapacity();

/** Ships entering from beyond the map edge already point along their course, under full sail. */
export const faceCourse = (ship: NavalShip) => {
  ship.speed = SHIP_SPEED; ship.yaw = initialRouteHeading({ ...ship, speed: SHIP_SPEED }, ship.route);
};

export interface VisitorShipsOptions {
  addShip: (point: SettlementPoint, yaw?: number) => number;
  /** The ship's boxes start to move one by one between it and the harbour's storage. */
  beginTransfer: (ship: NavalShip) => void;
  berthing: FleetBerthing;
  context: SettlementContext;
  hooks?: NavalPassengerHooks;
  planner: ReturnType<typeof createShipRoutePlanner>;
  ships: NavalShip[];
  sea: Uint8Array;
  /** Hands out the next transport order id. */
  takeOrderId: () => number;
  /** Just in time: `ship` sailing from `from` to `target` off harbour `uid` gets there about when it is free. */
  arrivesInTime: (ship: NavalShip, uid: number, from: SettlementPoint, target: SettlementPoint) => boolean;
}

/**
 * Ships from other islands: sailing in from beyond the map edge, unloading, picking up wares or
 * soldiers and sailing off the map again. Created once per fleet.
 */
export const createVisitorShips = ({
  addShip, arrivesInTime, beginTransfer, berthing, context, hooks, planner, sea, ships, takeOrderId
}: VisitorShipsOptions) => {
  const {
    anchorage, clearingBerth, dock, entryClear, makeWay, obstacles, queueAt, queuedNear, route, routeEndpoint,
    seaExitAt
  } = berthing;
  const finishVisitor = (ship: NavalShip) => {
    if (ship.visitor?.relief && !reliefShipOutsideMap(context.options.world, ship)) {
      sailReliefOffMap(context.options.world, sea, ship, obstacles(ship)); return;
    }
    if (isTradeShip(ship)) hooks?.tradeShipGone?.(ship.visitor.trade.delivery, ship.id);
    if (ship.visitor?.pickupTroops && ship.passengers?.length) {
      hooks?.visitorTroopsDepart?.(ship.passengers);
      ship.passengers = []; ship.cargoCount = 0;
    }
    ship.gone = true;
  };
  const leave = (ship: NavalShip) => {
    ship.visitor!.leaving = true;
    if (ship.visitor?.relief?.tail) return sailReliefOffMap(context.options.world, sea, ship, obstacles(ship));
    if (route(ship, ship.visitor!.exit, "sailing")) return true;
    if (ship.visitor?.relief) { ship.phase = "stranded"; ship.timer = 1; return false; }
    finishVisitor(ship); return false;
  };
  /** Soldiers to collect at the harbour walk aboard over the pier. */
  const servePickupTroops = (ship: NavalShip, destination: SettlementBuilding) => {
    const ids = hooks?.reserveTroops?.(ship.visitor!.pickupTroops!, destination);
    if (!ids) return;
    ship.passengers = ids; ship.cargoCount = ids.length; ship.orderId = takeOrderId();
    for (const uid of ids) context.actors.find(actor => actor.uid === uid)!.navalOrder = ship.orderId;
    ship.sourceUid = destination.uid; ship.phase = "loading";
    ship.handling = planHandling(context, ship, true); ship.timer = ship.handling.seconds;
  };
  /**
   * Unload, then fill the 33-box hold with the requested wares (heavy wares fill boxes sooner); the colony
   * resource ship takes all of them (owner 2026-10-19, settlement-naval-logistics.ts). The wares leave the
   * harbour box by box as the porters carry them aboard (owner 2026-10-20).
   */
  const serveVisitor = (ship: NavalShip, destination: SettlementBuilding) => {
    if (ship.visitor?.pickupTroops) { servePickupTroops(ship, destination); return; }
    const taken: Goods = {};
    let boxes = ship.visitor?.role === "ore" ? Infinity : SHIP_DECK_BOXES;
    for (const ware of ship.visitor!.pickup) {
      const reserve = ship.visitor?.role === "ore" ? colonyUpgradeReserve(context.buildings, ware) : 0;
      const amount = Math.min(boxes * wareBoxUnits(ware), Math.max(0, (destination.inventory[ware] ?? 0) - reserve));
      if (amount <= 0) continue;
      taken[ware] = amount; boxes -= boxesFor(ware, amount);
    }
    ship.cargo = taken;
    ship.cargoCount = Object.values(taken).reduce((sum, count) => sum + count, 0);
    if (!ship.cargoCount) { leave(ship); return; }
    // The dock porters carry the pickup over the pier, as for any own load (owner, 2026-10-15).
    ship.sourceUid = destination.uid;
    ship.phase = "loading";
    ship.handling = planHandling(context, ship, true);
    ship.timer = ship.handling.seconds;
    beginTransfer(ship);
  };
  /**
   * A trade ship at the pier: the trade office stores its hold in the harbour and names the escrow wares the
   * dock porters carry aboard; with none (or for a delivery it no longer knows) the ship sails off.
   */
  const serveTradeShip = (ship: NavalShip & { visitor: TradeVisitor }, destination: SettlementBuilding) => {
    const outbound = hooks?.tradeUnloaded?.(ship.visitor.trade.delivery, ship.id, destination.uid) ?? null;
    ship.cargo = { ...outbound };
    ship.cargoCount = Object.values(ship.cargo).reduce((sum, count) => sum + count, 0);
    if (!ship.cargoCount) { leave(ship); return; }
    ship.sourceUid = destination.uid;
    ship.phase = "loading";
    ship.handling = planHandling(context, ship, true);
    ship.timer = ship.handling.seconds;
  };
  /** A visitor's pickup is aboard: it sails off the map. */
  const visitorLoaded = (ship: NavalShip) => {
    if (isTradeShip(ship)) hooks?.tradeLoaded?.(ship.visitor.trade.delivery, ship.id, ship.cargo);
    else if (!ship.visitor?.pickupTroops) hooks?.visitorLoaded?.(ship.cargo);
    leave(ship);
  };
  /**
   * A visitor waits beyond the map edge while another ship holds the way in, then sails in under
   * full sail; ships sent together arrive one after another instead of on top of each other.
   */
  const enterWhenClear = (ship: NavalShip) => {
    if (!entryClear(ship, ship)) { clearEntry(ship); return false; }
    const endpoint = routeEndpoint(ship, "sailing");
    // An idle ship is just making room at the berth: the visitor waits here a moment instead of sailing
    // to a waiting spot (its way there and back could cross the way of the ship making room).
    if (!endpoint && clearingBerth(ship.destinationUid!, ship)) return false;
    if (endpoint ? route(ship, endpoint, "sailing") : queueVisitor(ship)) { faceCourse(ship); return true; }
    if (endpoint) makeWay(ship, endpoint, ship.destinationUid);
    return false;
  };
  /**
   * An idle ship lying near the way in (e.g. at a berth beside the map edge) never leaves on its own, so the
   * waiting visitor asks it to make room, as a ship waiting off a harbour does (else it waits for good).
   */
  const clearEntry = (ship: NavalShip) => {
    const idleNear = ships.some(other => other !== ship && other.phase === "idle" && !other.visitor &&
      DMath.hypot(other.x - ship.x, other.z - ship.z) < ANCHORAGE_SPACING);
    if (idleNear && ship.destinationUid !== undefined && !ship.visitor?.leaving)
      makeWay(ship, dock(ship.destinationUid), ship.destinationUid);
  };
  /**
   * The harbour's berth is taken: a visitor first in the queue sails in to a waiting spot off it; behind
   * another ship waiting there it stays beyond the map edge.
   */
  const queueVisitor = (ship: NavalShip) => {
    if (!ship.visitor || ship.visitor.leaving || queuedNear(ship.destinationUid!, ship)) return false;
    const spot = anchorage(ship.destinationUid!, ship);
    if (!spot || !arrivesInTime(ship, ship.destinationUid!, ship, spot) || !route(ship, spot, "sailing")) return false;
    queueAt(ship, spot, false);
    return true;
  };
  /** Soldiers from another island land before a visitor loads its pickup. */
  const landTroops = (ship: NavalShip, destination: SettlementBuilding) => {
    if (!ship.troops?.length) return;
    hooks?.landTroops?.(ship.troops, destination.uid);
    ship.cargoCount -= ship.troops.length;
    ship.troops = undefined;
  };
  /** A ship from beyond the map edge sails in now, or waits off the map while the way in is busy. */
  const admitFromSea = (ship: NavalShip, destination: ShipDestination) => {
    if (!planner.route(ship, destination)) { ships.splice(ships.indexOf(ship), 1); return null; }
    if (!enterWhenClear(ship)) { ship.phase = "away"; ship.timer = 0; }
    return ship.id;
  };
  /**
   * A ship sails in from the map edge with `cargo` (and soldiers from another island) for the
   * harbour and leaves with `pickup` wares.
   */
  const sendVisitor = (
    destinationUid: number, cargo: Goods, pickup: readonly string[] = [], role: NavalVisitorRole = "supply",
    troops: readonly EmigratedTroop[] = [], travelSeconds = 0, sourceColony?: number, trade?: NavalVisitor["trade"]
  ) => {
    if (!Number.isFinite(travelSeconds) || travelSeconds < 0 || travelSeconds > 86400) return null;
    // A trade ship serves exactly one trade delivery (sent by the trade office, never as a bare visitor).
    if ((role === "trade") !== (trade !== undefined)) return null;
    const held = obstacles();
    const start = dock(destinationUid), exit = start && seaExitAt(start, point => held.every(other =>
      DMath.hypot(other.x - point.x, other.z - point.z) >= ANCHORAGE_SPACING));
    if (!start || !exit) return null;
    const id = addShip(exit);
    const ship = ships.find(entry => entry.id === id)!;
    Object.assign(ship, { cargo: { ...cargo }, destinationUid,
      visitor: { exit, pickup: [...pickup], ...(role === "supply" ? {} : { role }), sourceColony,
        ...(trade ? { trade: { ...trade } } : {}) } });
    if (troops.length) ship.troops = troops.map(troop => ({ ...troop }));
    ship.cargoCount = Object.values(cargo).reduce((sum, count) => sum + count, 0) + troops.length;
    const admitted = admitFromSea(ship, start);
    if (admitted !== null && travelSeconds > 0) { ship.phase = "away"; ship.timer = travelSeconds; }
    return admitted;
  };
  const requestTroopPickup = (harbour: number, ids: readonly number[], travelSeconds: number) => {
    const unique = [...new Set(ids)];
    if (!unique.length || unique.length !== ids.length || unique.some(uid =>
      ships.some(ship => ship.visitor?.pickupTroops?.includes(uid)))) return null;
    const id = sendVisitor(harbour, {}, [], "troops", [], travelSeconds);
    const ship = ships.find(ship => ship.id === id);
    if (ship?.visitor) ship.visitor.pickupTroops = unique;
    return id;
  };
  return {
    enterWhenClear, finishVisitor, landTroops, leave, requestTroopPickup, sendVisitor, serveTradeShip,
    serveVisitor, visitorLoaded
  };
};
