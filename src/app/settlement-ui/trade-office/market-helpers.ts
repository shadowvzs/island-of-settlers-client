import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { wareDisplayName } from "../../../shared/settlement/ware-names";
import type { MerchantOffer, TradeEscrow, TradeMarket } from "../../../shared/trade/trade-types";
import { TRADE_WARE_GROUPS, type TradeWareGroupId } from "../../../shared/trade/trade-ware-groups";
import type { SelectOption } from "../../components/helpers";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { getEscrowProgressText, getLotView } from "./helpers";
import type { SettlementTradeOffice } from "./types";

export type TradeCategory = TradeWareGroupId | "all";

const CATEGORY_LABELS = {
  building: M.trade.categoryBuilding,
  food: M.trade.categoryFoodAndDrinks,
  foodChain: M.trade.categoryFoodChain,
  raw: M.trade.categoryRaw,
  tools: M.trade.categoryTools,
  weapons: M.trade.categoryWeapons
} as const satisfies Readonly<Record<TradeWareGroupId, unknown>>;

/** Category dropdown: "All", then the shared trade ware groups. */
export const getTradeCategoryChoices = (i18n?: I18n): readonly SelectOption<TradeCategory>[] => [
  { label: translateMessage(i18n, M.trade.all), value: "all" },
  ...TRADE_WARE_GROUPS.map(group => ({
    label: translateMessage(i18n, CATEGORY_LABELS[group.id]), value: group.id
  }))
];

export const getOfferTakenText = (i18n?: I18n) => translateMessage(i18n, M.trade.taken);

/** Storage of a ware is full: no room at all (stock at or above the island's limit). */
export const storageFullReason = (ware: string, i18n?: I18n) =>
  translateMessage(i18n, M.trade.storageFull, { ware: wareDisplayName(ware) });

type TradeQueries = Pick<SettlementTradeOffice, "checkBuy" | "freeCapacity" | "storageFull">;

/** Stock at or above the storage limit (the simulation's query), else no free capacity left. */
export const isStorageFull = (trade: Pick<SettlementTradeOffice, "freeCapacity" | "storageFull">, ware: string) =>
  trade.storageFull?.(ware) ?? trade.freeCapacity(ware) <= 0;

/**
 * Whether Buy may run now, and why not: a taken offer, full storage for the delivered ware (owner rule),
 * then the simulation's own check (free stock, protected floor, capacity, harbour, level).
 */
export const getBuyState = (trade: TradeQueries, offer: MerchantOffer, i18n?: I18n) => {
  if (offer.status === "taken") return getOfferTakenText(i18n);
  if (isStorageFull(trade, offer.give.ware)) return storageFullReason(offer.give.ware, i18n);
  return trade.checkBuy(offer.id);
};

/** A taken offer whose payment carriers still bring to the harbour: "Already taken · 12/61 wares at the harbour". */
const getTakenText = (offer: MerchantOffer, escrow: readonly TradeEscrow[], i18n?: I18n) => {
  const progress = getEscrowProgressText(
    escrow.find(entry => entry.purpose === "purchase" && entry.ref === offer.id), i18n);
  return progress
    ? translateMessage(i18n, M.trade.takenProgress, { progress })
    : getOfferTakenText(i18n);
};

const getMarketRow = (
  trade: TradeQueries, offer: MerchantOffer, escrow: readonly TradeEscrow[], i18n?: I18n
) => {
  const give = getLotView(offer.give), want = getLotView(offer.want);
  const state = offer.status === "taken"
    ? getTakenText(offer, escrow, i18n) : getBuyState(trade, offer, i18n);
  const buyLabel = translateMessage(i18n, M.trade.buy, { give: give.text, want: want.text });
  return {
    buyDisabled: state !== true,
    buyLabel,
    buyTitle: state === true ? buyLabel : state,
    give,
    id: offer.id,
    merchant: offer.merchant,
    /** Shown under the row as well: phones have no hover tooltip. */
    reason: state === true ? "" : state,
    taken: offer.status === "taken",
    want
  };
};
export type MarketRow = ReturnType<typeof getMarketRow>;

/** Merchant offers in their quoted order (rows never move while the list is shown). */
export const getMarketRows = (
  trade: TradeQueries, market: Readonly<TradeMarket> | null, escrow: readonly TradeEscrow[] = [], i18n?: I18n
) => (market?.offers ?? []).map(offer => getMarketRow(trade, offer, escrow, i18n));

const groupWares = (category: TradeCategory) =>
  TRADE_WARE_GROUPS.find(group => group.id === category)?.wares ?? [];

/** Matches a ware name (either side) case-insensitively; an empty search matches everything. */
const matchesSearch = (row: MarketRow, search: string) => {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return [row.give.name, row.want.name].some(name => name.toLowerCase().includes(needle));
};

const matchesCategory = (row: MarketRow, category: TradeCategory) => {
  if (category === "all") return true;
  const wares = groupWares(category);
  return wares.includes(row.give.ware) || wares.includes(row.want.ware);
};

/** Filtered rows in the same stable order. */
export const filterMarketRows = (rows: readonly MarketRow[], category: TradeCategory, search: string) =>
  rows.filter(row => matchesCategory(row, category) && matchesSearch(row, search));

/** Empty-list text: no offers at all, or none matching the filters. */
export const getMarketEmptyText = (total: number, i18n?: I18n) =>
  translateMessage(i18n, total ? M.trade.noMatch : M.trade.noneToday);
