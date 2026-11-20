import type { GameSaveV1 } from "../settlement/game-save";
import type { Goods } from "../settlement/settlement-types";
import type { MerchantOffer, PlayerOffer, SettlementTradeSave, TradeHistoryEntry } from "./trade-types";

/**
 * Trade entities as table rows (database version 6, owner rule: a new kind of entity gets its own table).
 * Keyed [slotId, islandId, id]; `order` keeps the list order (ids do not sort numerically). Version 7 dropped
 * the trade mail table (owner 2026-10-19): old mail rows fold back into their island save, whose load credits
 * the wares to the harbour.
 */
interface IslandRow { id: string; islandId: string; order: number }
export type TradeOfferRow = IslandRow &
  ({ kind: "merchant"; offer: MerchantOffer } | { kind: "player"; offer: PlayerOffer });
export type TradeHistoryRow = IslandRow & { entry: TradeHistoryEntry };
/** A trade mail row of database version 6 (read only to return its wares). */
export type LegacyTradeMailRow = IslandRow & { mail: { goods: Goods; id: string } };
export interface TradeRows {
  tradeHistory: TradeHistoryRow[];
  tradeOffers: TradeOfferRow[];
}

export const emptyTradeRows = (): TradeRows => ({ tradeHistory: [], tradeOffers: [] });

/** Moves one island's offers and history into rows; the island save keeps the rest of its trade state. */
export const liftIslandTrade = (islandId: string, save: GameSaveV1, rows: TradeRows): GameSaveV1 => {
  const trade = save.settlement.trade;
  if (!trade) return save;
  const at = (value: { id: string }, order: number) => ({ id: value.id, islandId, order });
  rows.tradeOffers.push(
    ...(trade.market?.offers ?? []).map((offer, order) => ({ ...at(offer, order), kind: "merchant" as const, offer })),
    ...trade.offers.map((offer, order) => ({ ...at(offer, order), kind: "player" as const, offer })));
  rows.tradeHistory.push(...trade.history.map((entry, order) => ({ ...at(entry, order), entry })));
  const market = trade.market && { ...trade.market, offers: [] };
  const lifted: SettlementTradeSave = { ...trade, history: [], market, offers: [] };
  return { ...save, settlement: { ...save.settlement, trade: lifted } };
};

const ofIsland = <Row extends IslandRow>(rows: readonly Row[] | undefined, islandId: string) =>
  (rows ?? []).filter(row => row.islandId === islandId).sort((a, b) => a.order - b.order);

/** One island's rows of every trade table, in list order (the repository's read for the trade window). */
export const islandTradeRows = (rows: Partial<TradeRows>, islandId: string): TradeRows => ({
  tradeHistory: ofIsland(rows.tradeHistory, islandId),
  tradeOffers: ofIsland(rows.tradeOffers, islandId)
});

/** A stored (slotted) trade mail row of database version 6. */
export type LegacyMailRow = LegacyTradeMailRow & { slotId: string };

/**
 * Database version 7 / account file version 4: a mail row returns into its island save's legacy `mail` list
 * (credited to the harbour on load). Null when the island has no trade state to take it.
 */
export const foldMailIntoIsland = <Row extends { save: GameSaveV1 }>(island: Row, mail: LegacyTradeMailRow["mail"]) => {
  const trade = island.save.settlement.trade;
  if (!trade) return null;
  const folded = withLegacyMail(trade, [{ id: mail.id, islandId: "", mail, order: 0 }]);
  return { ...island, save: { ...island.save, settlement: { ...island.save.settlement, trade: folded } } };
};

/** Old mail rows return into the island save's legacy `mail` list (credited to the harbour on load). */
const withLegacyMail = (trade: SettlementTradeSave, mail: readonly LegacyTradeMailRow[]) => {
  if (!mail.length) return trade;
  const saved = (trade as { mail?: unknown[] }).mail ?? [];
  return { ...trade, mail: [...saved, ...mail.map(row => row.mail)] } as SettlementTradeSave;
};

/** Puts an island's rows back into its trade state (rows are only written for islands with trade state). */
export const restoreIslandTrade = (
  islandId: string, save: GameSaveV1, rows: Partial<TradeRows> & { tradeMail?: readonly LegacyTradeMailRow[] }
): GameSaveV1 => {
  const trade = save.settlement.trade;
  if (!trade) return save;
  const { tradeHistory, tradeOffers } = islandTradeRows(rows, islandId);
  const merchantOffers = tradeOffers.flatMap(row => row.kind === "merchant" ? [row.offer] : []);
  const market = trade.market && { ...trade.market, offers: [...trade.market.offers, ...merchantOffers] };
  const restored: SettlementTradeSave = {
    ...withLegacyMail(trade, ofIsland(rows.tradeMail, islandId)),
    history: [...trade.history, ...tradeHistory.map(row => row.entry)],
    market,
    offers: [...trade.offers, ...tradeOffers.flatMap(row => row.kind === "player" ? [row.offer] : [])]
  };
  return { ...save, settlement: { ...save.settlement, trade: restored } };
};

