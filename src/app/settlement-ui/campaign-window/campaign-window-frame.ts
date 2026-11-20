import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { createReactSettlementWindow } from "../react-window";
import type { SettlementUiStore } from "../ui-store";
import { CAMPAIGN_WINDOW_MESSAGES as M } from "./messages";
import type { CampaignWindowPort } from "./types";

/** Campaign window opened from the bottom bar on the home island (C8). */
export const createCampaignWindow = (store: SettlementUiStore, port: CampaignWindowPort, i18n?: I18n) =>
  createReactSettlementWindow({
    className: "settlement-ui__campaign-window",
    contentClassName: "settlement-ui__overview campaign-window",
    heading: translateMessage(i18n, M.title),
    id: "settlement-campaign-title",
    load: async visibility => (await import("./mount")).createCampaignWindowMount(store, visibility, port)
  });
