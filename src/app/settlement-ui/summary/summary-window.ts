import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { createReactSettlementWindow } from "../react-window";
import type { SettlementUiStore } from "../ui-store";

/** Main Selection launches an independent window; statistics never occupy the launcher menu. */
export const createSettlementSummaryWindow = (store: SettlementUiStore, i18n?: I18n) => createReactSettlementWindow({
  className: "settlement-ui__summary-window",
  contentClassName: "settlement-ui__summary",
  heading: translateMessage(i18n, M.summary.title),
  id: "settlement-summary-title",
  load: async visibility => (await import("./mount")).createSummaryMount(store, visibility)
});
