import { TRADE_HISTORY_LIMIT } from "@shared/catalog/balance";

import type { Goods } from "../settlement/settlement-types";
import type {
  SettlementTradeSave, TradeDeliveryRequest, TradeEscrow, TradeHistoryEntry, TradeLot, TradeReservation
} from "./trade-types";

/** Fresh trade state of an island (also for saves made before the trade office). */
export const createTradeState = (): SettlementTradeSave => ({
  buyerClock: 0, deliveries: [], elapsed: 0, escrow: [], floors: {}, history: [], market: null, nextId: 1,
  npcTraders: false, offers: [], version: 2
});

/** Next id of a trade record kind: `<prefix><n>`, unique within the island. */
export const nextTradeId = (state: SettlementTradeSave, prefix: string) => `${prefix}${state.nextId++}`;

export const lotGoods = (lot: TradeLot): Goods => ({ [lot.ware]: lot.amount });

export const addEscrow = (
  state: SettlementTradeSave, purpose: TradeEscrow["purpose"], ref: string, goods: Goods,
  { custody, harbourUid, held, staged }: TradeReservation
) => {
  const escrow: TradeEscrow = {
    goods, held, id: nextTradeId(state, "e"), purpose, ref, staged, ...(custody ? { custody: structuredClone(custody) } : {}), ...(harbourUid === undefined ? {} : { harbourUid })
  };
  state.escrow.push(escrow);
  return escrow;
};

export const addDelivery = (
  state: SettlementTradeSave, kind: TradeDeliveryRequest["kind"], ref: string, goods: Goods, escrowId?: string,
  createdAt = state.elapsed
) => {
  const delivery: TradeDeliveryRequest = {
    createdAt, goods, id: nextTradeId(state, "d"), kind, ref, ...(escrowId ? { escrowId } : {})
  };
  state.deliveries.push(delivery);
  return delivery;
};

/** Appends a history entry; only the newest TRADE_HISTORY_LIMIT stay. */
export const addHistory = (state: SettlementTradeSave, entry: Omit<TradeHistoryEntry, "id">) => {
  state.history.push({ ...entry, id: nextTradeId(state, "h") });
  if (state.history.length > TRADE_HISTORY_LIMIT)
    state.history.splice(0, state.history.length - TRADE_HISTORY_LIMIT);
};

/** Wares still to arrive by trade ship: they count as incoming storage. */
export const pendingTradeIncoming = (state: SettlementTradeSave, ware: string) =>
  state.deliveries.reduce((sum, delivery) => sum + (delivery.goods[ware] ?? 0), 0);

export const removeById = <T extends { id: string }>(list: T[], id: string) => {
  const index = list.findIndex(entry => entry.id === id);
  return index < 0 ? undefined : list.splice(index, 1)[0];
};

/** Goods plus goods (a new object). */
export const addGoods = (to: Readonly<Goods>, added: Readonly<Goods>): Goods => {
  const sum: Goods = { ...to };
  for (const [ware, amount] of Object.entries(added)) if (amount > 0) sum[ware] = (sum[ware] ?? 0) + amount;
  return sum;
};

export const goodsCount = (goods: Readonly<Goods>) => Object.values(goods).reduce((sum, amount) => sum + amount, 0);

/** Goods minus goods, dropping emptied wares. */
export const subtractGoods = (from: Readonly<Goods>, taken: Readonly<Goods>): Goods =>
  Object.fromEntries(Object.entries(from)
    .map(([ware, amount]) => [ware, amount - (taken[ware] ?? 0)] as const)
    .filter(([, amount]) => amount > 0));
