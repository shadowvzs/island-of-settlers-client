import type { I18n } from "@lingui/core";

import type { SettlementUiSnapshot } from "../types";
import { isSameRows, type TradeOfficePanel } from "./helpers";
import { getMarketRows } from "./market-helpers";
import { getHistoryRows, getOwnOfferRows } from "./offers-helpers";
import { getGiveChoices, getIslandTradeWares, getWantChoices } from "./place-offer-helpers";
import type { SettlementTradeOffice } from "./types";

/**
 * Everything the trade office shows, read from the trade queries at the UI cadence (each 0.5 s tick and
 * after each command) while the window is visible. Only the shown panel's rows are computed; the offer count
 * is always needed (place panel and My offers).
 */
export const selectTradeOffice = (
  snapshot: Readonly<SettlementUiSnapshot>, trade: SettlementTradeOffice, panel: TradeOfficePanel, i18n?: I18n
) => {
  const state = trade.snapshot();
  const wares = panel === "place" ? getIslandTradeWares(snapshot) : [];
  return {
    activeOffers: state.offers.length,
    giveChoices: getGiveChoices(trade, wares, i18n),
    history: panel === "history" ? getHistoryRows(state.history, i18n?.locale, i18n) : [],
    market: panel === "market" ? getMarketRows(trade, state.market, state.escrow, i18n) : [],
    npcTradersOff: state.npcTraders === false,
    offerLimit: trade.offerLimit,
    offers: panel === "offers" ? getOwnOfferRows(state, trade.deliveryStatus?.(), i18n) : [],
    wantChoices: getWantChoices(trade, wares, i18n)
  };
};
export type TradeOfficeData = ReturnType<typeof selectTradeOffice>;

/** Same shown values: an unchanged tick causes no re-render. */
export const isSameTradeOffice = (left: TradeOfficeData, right: TradeOfficeData) =>
  left.activeOffers === right.activeOffers &&
  left.npcTradersOff === right.npcTradersOff && left.offerLimit === right.offerLimit &&
  isSameRows(left.market, right.market) && isSameRows(left.offers, right.offers) &&
  isSameRows(left.history, right.history) && isSameRows(left.giveChoices, right.giveChoices) &&
  isSameRows(left.wantChoices, right.wantChoices);
