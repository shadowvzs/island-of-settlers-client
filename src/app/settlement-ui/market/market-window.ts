import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import type { MarketControls } from "../../../shared/trade/market";
import { guardedByOnlineFeature } from "../../backend/online-features";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { createReactSettlementWindow } from "../react-window";
import type { SettlementUiStore } from "../ui-store";

/**
 * The combined Player Market window, reached from the Main selection. It exists without a cloud session
 * too: guests and offline players get a clear unavailable message, never a local simulation of the server.
 * While the game's market switch is off it never opens, whoever asks (menu, map script).
 */
export const createMarketWindow = (store: SettlementUiStore, market?: MarketControls, i18n?: I18n) =>
  guardedByOnlineFeature("market", createReactSettlementWindow({
    className: "settlement-ui__player-market-window",
    contentClassName: "settlement-ui__overview player-market-window__content",
    heading: translateMessage(i18n, M.market.title),
    id: "settlement-player-market-title",
    load: async visibility => (await import("./mount")).createMarketMount(store, visibility, market)
  }));
