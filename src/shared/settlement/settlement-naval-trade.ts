import { TRADE_SHIP_VOYAGE_SECONDS } from "@shared/catalog/balance";

import type { TradeShipPort } from "../trade/trade-types";
import type { NavalShip, NavalVisitor } from "./settlement-naval-fleet";
import type { Goods, SettlementContext } from "./settlement-types";

/**
 * The neutral trade ship (TRADE-01 phase 2, visitor role `trade`): it sails in from beyond the map edge for
 * one trade delivery, unloads into the harbour, loads the escrow from the harbour's trade stock and leaves.
 * The trade office (shared/trade/trade-shipping.ts) owns the wares; the fleet only moves the ship and calls back.
 */

/** A ship that serves a trade delivery. */
export type TradeVisitor = NavalVisitor & { trade: { delivery: string; queue: number } };
export const isTradeShip = (ship: NavalShip): ship is NavalShip & { visitor: TradeVisitor } =>
  ship.visitor?.trade !== undefined;

/** A trade ship sent ahead of its payment: it waits offshore and lets every other ship pass. */
export const isCollectingTradeShip = (ship: NavalShip) => isTradeShip(ship) && ship.visitor.trade.collecting === true;

/** A trade ship bound for (or lying at) a berth, not waiting offshore, beyond the map edge or leaving. */
const holdsPier = (ship: NavalShip & { visitor: TradeVisitor }) => !ship.visitor.leaving && ship.phase !== "away" &&
  ship.queuedAt === undefined && ship.phase !== "idle";

/**
 * Pier queue (owner 2026-10-19): one trade ship lies at a harbour's pier at a time. A trade ship may take a
 * berth only while no other trade ship holds that harbour's pier and no waiting trade ship there has a lower
 * queue number; the others wait offshore, in queue order. Other ships are not affected.
 */
export const tradePierTurn = (ships: readonly NavalShip[], ship: NavalShip, harbourUid: number) => {
  if (!isTradeShip(ship) || ship.visitor.leaving) return true;
  if (ship.visitor.trade.collecting) return false;
  const own = ship.visitor.trade.queue;
  return !ships.some(other => other !== ship && isTradeShip(other) && !other.visitor.leaving &&
    other.destinationUid === harbourUid &&
    (holdsPier(other) || (!other.visitor.trade.collecting && other.visitor.trade.queue < own)));
};

/** Fleet callbacks of trade ships, answered by the island's trade office. */
export interface TradeShipHooks {
  /** The ship's hold reached the harbour: the trade stores it there and names the escrow wares to load. */
  tradeUnloaded?(deliveryId: string, shipId: number, harbourUid: number): Goods | null;
  /** One box of the hold reached the harbour (box by box unloading): the trade stores it there. */
  tradeBoxUnloaded?(deliveryId: string, shipId: number, harbourUid: number, box: Goods): void;
  tradeLoaded?(deliveryId: string, shipId: number, cargo?: Readonly<Goods>): void;
  tradeShipGone?(deliveryId: string, shipId: number): void;
}

/** The trade office's side of the fleet hooks (context.trade, created after the naval controller). */
export const tradeShipHooks = (context: SettlementContext): TradeShipHooks => ({
  tradeBoxUnloaded: (delivery, ship, harbour, box) => context.trade?.shipBoxUnloaded(delivery, ship, harbour, box),
  tradeLoaded: (delivery, ship) => context.trade?.shipLoaded(delivery, ship),
  tradeShipGone: (delivery, ship) => context.trade?.shipGone(delivery, ship),
  tradeUnloaded: (delivery, ship, harbour) => context.trade?.shipUnloaded(delivery, ship, harbour) ?? null
});

interface TradeFleet {
  bestHarbour(pickup?: readonly string[], preferred?: number): number | undefined;
  saveState(): { ships: readonly NavalShip[] };
  sendVisitor(destinationUid: number, cargo: Goods, pickup?: readonly string[], role?: "trade",
    troops?: readonly never[], travelSeconds?: number, sourceColony?: number,
    trade?: TradeVisitor["trade"]): number | null;
}

/** The trade office's ship port: trade ships sail in after TRADE_SHIP_VOYAGE_SECONDS beyond the map edge. */
export const createTradeShipPort = (fleet: TradeFleet): TradeShipPort => ({
  /** The payment reached the harbour: the ship sent ahead may come to the pier. */
  ready: (shipId) => {
    const ship = fleet.saveState().ships.find(each => each.id === shipId);
    if (ship && isTradeShip(ship)) delete ship.visitor.trade.collecting;
  },
  send: (harbourUid, cargo, delivery, queue, collecting) => fleet.sendVisitor(harbourUid, { ...cargo }, [], "trade",
    [], TRADE_SHIP_VOYAGE_SECONDS, undefined, { ...(collecting ? { collecting: true as const } : {}), delivery, queue }),
  shipIds: () => new Set(fleet.saveState().ships.filter(isTradeShip).map(ship => ship.id))
});
