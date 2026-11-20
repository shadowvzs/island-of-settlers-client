import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import type {
  PlayerOffer, SettlementTradeSave, TradeDeliveryRequest, TradeDeliveryStatus, TradeHistoryEntry, TradeLot
} from "../../../shared/trade/trade-types";
import { describeWares } from "../helpers";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { countWares, formatTradeTime, getEscrowProgressText, getLotView, type TradeLotView } from "./helpers";

export const getNpcTradersOffText = (i18n?: I18n) => translateMessage(i18n, M.trade.npcOff);
export const getOffersEmptyText = (i18n?: I18n) => translateMessage(i18n, M.trade.noActiveOffers);
export const getHistoryEmptyText = (i18n?: I18n) => translateMessage(i18n, M.trade.noTrades);

/** Carriers still bring the offer's wares to the harbour: its escrow is not fully staged there yet. */
export const isWaitingForCarriers = (state: Readonly<SettlementTradeSave>, offer: PlayerOffer) => {
  const escrow = state.escrow.find(entry => entry.id === offer.escrowId);
  return Boolean(escrow && countWares(escrow.staged ?? {}) < countWares(escrow.goods));
};

export const getOfferCountText = (active: number, limit: number, i18n?: I18n) =>
  translateMessage(i18n, M.trade.activeOffers, { active, limit });

const getReturnText = (give: TradeLot, i18n?: I18n) =>
  translateMessage(i18n, M.trade.returnText, { wares: getLotView(give).text });

interface TradePairView { give: TradeLotView; want: TradeLotView }

const getOwnOfferRow = (
  state: Readonly<SettlementTradeSave>, offer: PlayerOffer, i18n?: I18n
) => ({
  canCancel: true,
  cancelLabel: translateMessage(i18n, M.trade.cancelOffer, {
    give: getLotView(offer.give).text, want: getLotView(offer.want).text
  }),
  goodsText: "",
  id: offer.id,
  pair: { give: getLotView(offer.give), want: getLotView(offer.want) } as TradePairView | null,
  returnText: getReturnText(offer.give, i18n),
  status: translateMessage(i18n,
    isWaitingForCarriers(state, offer) ? M.trade.waitingForCarriers : M.trade.listed)
});
export type OwnOfferRow = ReturnType<typeof getOwnOfferRow>;

const DELIVERY_STATUS = {
  purchase: M.trade.boughtDelivering,
  refund: M.trade.cancelledReturning,
  sale: M.trade.filledDelivering
} as const satisfies Readonly<Record<TradeDeliveryRequest["kind"], unknown>>;

const STAGE_TEXT = {
  blocked: M.trade.stageWaiting,
  collecting: M.trade.stageCollecting,
  queued: M.trade.stageQueued,
  shipping: M.trade.stageShipping
} as const satisfies Readonly<Record<TradeDeliveryStatus["stage"], unknown>>;

/**
 * "Filled · delivering", refined by the delivery's stage (and blocker) when the simulation reports it; while
 * carriers collect the payment, how much of it is at the harbour.
 */
export const getDeliveryStatusText = (
  delivery: TradeDeliveryRequest, status?: TradeDeliveryStatus, progress = "", i18n?: I18n
) => {
  const base = translateMessage(i18n, DELIVERY_STATUS[delivery.kind]);
  if (!status) return base;
  if (status.stage === "collecting" && progress)
    return translateMessage(i18n, M.trade.deliveryStatusProgress, { base, progress });
  return translateMessage(i18n, M.trade.deliveryStatus, {
    base, detail: status.blocker ?? translateMessage(i18n, STAGE_TEXT[status.stage])
  });
};

/** The island's pending trade-ship deliveries (filled offers, purchases, cancelled returns). */
const getDeliveryRow = (
  state: Readonly<SettlementTradeSave>, delivery: TradeDeliveryRequest, status?: TradeDeliveryStatus,
  i18n?: I18n
): OwnOfferRow => ({
  canCancel: false,
  cancelLabel: "",
  goodsText: describeWares(delivery.goods),
  id: delivery.id,
  pair: null,
  returnText: "",
  status: getDeliveryStatusText(delivery, status,
    getEscrowProgressText(state.escrow.find(entry => entry.id === delivery.escrowId), i18n), i18n)
});

/** Active offers first (placing order), then the deliveries on their way. */
export const getOwnOfferRows = (
  state: Readonly<SettlementTradeSave>, statuses: readonly TradeDeliveryStatus[] = [], i18n?: I18n
) => [
  ...state.offers.map(offer => getOwnOfferRow(state, offer, i18n)),
  ...state.deliveries.map(delivery =>
    getDeliveryRow(state, delivery, statuses.find(status => status.id === delivery.id), i18n))
];

const HISTORY_LABELS = {
  bought: M.trade.historyBought,
  cancelled: M.trade.historyCancelled,
  expired: M.trade.historyExpired,
  sold: M.trade.historySold
} as const satisfies Readonly<Record<TradeHistoryEntry["kind"], unknown>>;

const getHistoryTitle = (entry: TradeHistoryEntry, i18n?: I18n) => {
  const action = translateMessage(i18n, HISTORY_LABELS[entry.kind]);
  if (entry.merchant) return translateMessage(i18n, M.trade.historyFrom, { action, merchant: entry.merchant });
  return action;
};

const getHistoryRow = (entry: TradeHistoryEntry, locale?: string, i18n?: I18n) => ({
  gave: entry.gave ? getLotView(entry.gave) : null,
  id: entry.id,
  kind: entry.kind,
  received: entry.received ? getLotView(entry.received) : null,
  time: formatTradeTime(entry.at, locale),
  title: getHistoryTitle(entry, i18n)
});
export type TradeHistoryRow = ReturnType<typeof getHistoryRow>;

/** Empty-list text, or "" when rows exist. */
export const getEmptyText = (count: number, text: string) => (count ? "" : text);

/** Newest first, with real date and time in the player's locale. */
export const getHistoryRows = (history: readonly TradeHistoryEntry[], locale?: string, i18n?: I18n) =>
  history.map(entry => getHistoryRow(entry, locale, i18n)).reverse();
