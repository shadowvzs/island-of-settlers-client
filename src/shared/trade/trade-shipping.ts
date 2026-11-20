import { TRADE_SHIPS_PER_HARBOUR } from "@shared/catalog/balance";

import type { Goods } from "../settlement/settlement-types";
import { isEscrowCollected } from "./trade-escrow";
import { goodsCount, removeById, subtractGoods } from "./trade-ledger";
import type {
  SettlementTradeSave, TradeDeliveryRequest, TradeDeliveryStatus, TradeEscrow, TradeIslandPort, TradeShipPort
} from "./trade-types";

/**
 * The neutral trade ship (TRADE-01 phase 2): every delivery whose escrow is collected gets a ship to the trade
 * harbour. Trade ships are exempt from the hold limit (owner 2026-10-19): one ship brings the whole delivery,
 * unloads it into the harbour (overflowing storage like any committed arrival, architecture decision 7) and
 * loads the whole escrow from the harbour's trade stock; its deck shows at most a full hold and the pier time is
 * that of the visible boxes (settlement-naval-ship-handling.ts). One trade ship lies at the pier at
 * a time, the others wait offshore in queue order (fleet side, settlement-naval-trade.ts).
 */

const TRADE_REASONS_SHIPPING = Object.freeze({
  collecting: "Carriers are bringing the paid wares to the harbour",
  noHarbour: "The island needs a finished harbour for the trade ship",
  noSeaWay: "The trade ship cannot reach the harbour from the open sea",
  queued: "Waiting for a free trade ship"
});

/** Everything still owed of `goods` (positive amounts only): a trade ship takes it all in one go. */
export const shipLoad = (goods: Readonly<Goods>): Goods => {
  const load: Goods = {};
  for (const [ware, amount] of Object.entries(goods)) if (amount > 0) load[ware] = amount;
  return load;
};

const escrowOf = (state: SettlementTradeSave, delivery: TradeDeliveryRequest) =>
  delivery.escrowId === undefined ? undefined : state.escrow.find(entry => entry.id === delivery.escrowId);

/** Nothing left to bring and nothing left to take: the delivery (and its escrow) are done. */
const finishIfDone = (state: SettlementTradeSave, delivery: TradeDeliveryRequest) => {
  const escrow = escrowOf(state, delivery);
  if (goodsCount(delivery.goods) || (escrow && goodsCount(escrow.goods))) return;
  removeById(state.deliveries, delivery.id);
  if (escrow) removeById(state.escrow, escrow.id);
};

const clearShip = (delivery: TradeDeliveryRequest) => {
  delete delivery.aboard; delete delivery.outbound; delete delivery.queue; delete delivery.shipId;
};

const harbourShips = (state: SettlementTradeSave) =>
  state.deliveries.filter(entry => entry.shipId !== undefined).length;

/** Part of the payment is not in the harbour's trade stock yet (a harbour of its pool is missing). */
const collectingStatus = (id: string) => ({ id, stage: "collecting" as const });

/** The ship already sails for the delivery: it may berth once the payment lies at the harbour. */
const servedStatus = (
  delivery: TradeDeliveryRequest, escrow: TradeEscrow | undefined, ships: TradeShipPort
): TradeDeliveryStatus => {
  if (escrow && !isEscrowCollected(escrow)) return collectingStatus(delivery.id);
  if (delivery.aboard !== undefined) ships.ready(delivery.shipId!);
  return { id: delivery.id, stage: "shipping" };
};

/**
 * Sends a trade ship for each waiting delivery (in delivery order) while the trade harbour has fewer than
 * TRADE_SHIPS_PER_HARBOUR trade ships under way. While the escrow is not collected yet the ship waits
 * offshore and berths once the payment is at the harbour. Returns each delivery's status.
 */
export const dispatchTradeShips = (
  state: SettlementTradeSave, harbourUid: number | undefined, ships: TradeShipPort
): TradeDeliveryStatus[] => state.deliveries.map(delivery => {
  const escrow = escrowOf(state, delivery);
  if (delivery.shipId !== undefined) return servedStatus(delivery, escrow, ships);
  const collecting = escrow !== undefined && !isEscrowCollected(escrow);
  const targetHarbour = escrow ? escrow.harbourUid : harbourUid;
  if (targetHarbour === undefined) return { blocker: TRADE_REASONS_SHIPPING.noHarbour, id: delivery.id, stage: "blocked" };
  if (harbourShips(state) >= TRADE_SHIPS_PER_HARBOUR) {
    return collecting ? collectingStatus(delivery.id) : { id: delivery.id, stage: "queued" };
  }
  const aboard = shipLoad(delivery.goods), queue = state.nextId++;
  const shipId = ships.send(targetHarbour, aboard, delivery.id, queue, collecting);
  if (shipId === null) return { blocker: TRADE_REASONS_SHIPPING.noSeaWay, id: delivery.id, stage: "blocked" };
  Object.assign(delivery, { aboard, queue, shipId });
  return collecting ? collectingStatus(delivery.id) : { id: delivery.id, stage: "shipping" };
});

/** Hears the wares of `delivery` a trade ship has just stored at harbour `harbourUid` (script event). */
export type TradeArrivalListener = (
  delivery: Readonly<TradeDeliveryRequest>, goods: Readonly<Goods>, harbourUid: number
) => void;

/** The serving ship of `deliveryId` is `shipId` (anything else is a stale or foreign ship). */
const servedBy = (state: SettlementTradeSave, deliveryId: string, shipId: number) =>
  state.deliveries.find(entry => entry.id === deliveryId && entry.shipId === shipId);

/**
 * The ship unloaded at harbour `harbourUid`: its wares enter that harbour (no capacity limit) and leave the
 * delivery. Returns the escrow wares it loads next (one hold), or null for a ship the trade does not know
 * (it unloads nothing and sails off).
 */
export const tradeShipUnloaded = (
  state: SettlementTradeSave, port: TradeIslandPort, deliveryId: string, shipId: number, harbourUid: number,
  onArrived?: TradeArrivalListener
): Goods | null => {
  const delivery = servedBy(state, deliveryId, shipId);
  if (!delivery) return null;
  const aboard = delivery.aboard ?? {}, escrow = escrowOf(state, delivery);
  if (port.store(aboard, harbourUid, escrow?.custody) === false) return null;
  if (onArrived && goodsCount(aboard)) onArrived(delivery, aboard, harbourUid);
  delivery.goods = subtractGoods(delivery.goods, aboard);
  delete delivery.aboard;
  const outbound = escrow ? shipLoad(escrow.staged) : {};
  if (goodsCount(outbound)) delivery.outbound = outbound;
  return outbound;
};

/**
 * One box of the ship's hold reached harbour `harbourUid` (the porters or lighters bring it in box by box,
 * owner 2026-10-20): its wares enter the harbour and leave the hold and the delivery; `tradeShipUnloaded`
 * stores whatever is left at the end.
 */
export const tradeShipBoxUnloaded = (
  state: SettlementTradeSave, port: TradeIslandPort, deliveryId: string, shipId: number, harbourUid: number,
  box: Readonly<Goods>, onArrived?: TradeArrivalListener
) => {
  const delivery = servedBy(state, deliveryId, shipId), aboard = delivery?.aboard;
  if (!delivery || !aboard) return;
  const part: Goods = {};
  for (const [ware, count] of Object.entries(box)) {
    const moved = Math.min(count, aboard[ware] ?? 0);
    if (moved > 0) part[ware] = moved;
  }
  if (port.store(part, harbourUid, escrowOf(state, delivery)?.custody) === false) return;
  if (onArrived && goodsCount(part)) onArrived(delivery, part, harbourUid);
  delivery.aboard = subtractGoods(aboard, part);
  delivery.goods = subtractGoods(delivery.goods, part);
};

/** The ship has the escrow wares aboard: they leave the island for good. */
export const tradeShipLoaded = (state: SettlementTradeSave, deliveryId: string, shipId: number) => {
  const delivery = servedBy(state, deliveryId, shipId);
  if (!delivery) return;
  const escrow = escrowOf(state, delivery), outbound = delivery.outbound ?? {};
  if (escrow) {
    escrow.staged = subtractGoods(escrow.staged, outbound);
    escrow.goods = subtractGoods(escrow.goods, outbound);
  }
  clearShip(delivery);
  finishIfDone(state, delivery);
};

/**
 * The ship left the map. Anything it did not unload is still owed (the delivery waits for the next ship, e.g.
 * at the island's next harbour); a loaded hold was settled by `tradeShipLoaded` already.
 */
export const tradeShipGone = (state: SettlementTradeSave, deliveryId: string, shipId: number) => {
  const delivery = servedBy(state, deliveryId, shipId);
  if (!delivery) return;
  clearShip(delivery);
  finishIfDone(state, delivery);
};

/** After a load: a delivery whose ship no longer exists waits for a new one (nothing was settled twice). */
export const reconcileTradeShips = (state: SettlementTradeSave, ships: ReadonlySet<number>) => {
  for (const delivery of state.deliveries)
    if (delivery.shipId !== undefined && !ships.has(delivery.shipId)) clearShip(delivery);
};
