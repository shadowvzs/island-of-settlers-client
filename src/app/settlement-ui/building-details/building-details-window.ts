import { translateMessage } from "../../../shared/i18n/translate";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { createReactSettlementWindow } from "../react-window";
import type { SettlementUiOptions } from "../types";
import type { SettlementUiStore } from "../ui-store";

/**
 * Building details window: the shared frame (title = the focused building's name, set by the caller)
 * with lazily mounted React sections. Closing clears the focus (`onClose`).
 */
export const createBuildingDetailsWindow = (
  store: SettlementUiStore, options: SettlementUiOptions, onClose: () => void
) => createReactSettlementWindow({
  className: "settlement-ui__building-details-window",
  contentClassName: "settlement-ui__overview",
  heading: translateMessage(options.i18n, M.details.title),
  id: "settlement-building-details-title",
  load: async visibility => (await import("./mount")).createBuildingDetailsMount(store, visibility, options),
  onClose
});
