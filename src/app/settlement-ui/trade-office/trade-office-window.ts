import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { createReactSettlementWindow } from "../react-window";
import type { SettlementUiStore } from "../ui-store";
import type { SettlementTradeOffice } from "./types";

/**
 * Trade office window opened from the harbour details' market button. The island's trade (market, offers,
 * history) loads with React on the first open; panel, filters and the place-offer draft survive closing.
 */
export const createTradeOfficeWindow = (
  store: SettlementUiStore, trade: SettlementTradeOffice, i18n?: I18n
) =>
  createReactSettlementWindow({
    className: "settlement-ui__trade-office-window",
    contentClassName: "settlement-ui__overview trade-office-window__content",
    heading: translateMessage(i18n, M.trade.title),
    id: "settlement-trade-office-title",
    load: async visibility => (await import("./mount")).createTradeOfficeMount(store, visibility, trade)
  });
