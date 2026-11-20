import { translateMessage } from "../../../shared/i18n/translate";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { createReactSettlementWindow } from "../react-window";
import type { SettlementUiOptions, SettlementUiSnapshot } from "../types";
import type { SettlementUiStore } from "../ui-store";
import { getBridgeDetailsTitle } from "./helpers";

/**
 * The bridge panel: the building-details frame and classes with lazily mounted bridge content. It owns
 * the focused-bridge field of the UI store and tells the session which bridge to outline.
 */
export const createBridgePanel = (
  store: SettlementUiStore, options: SettlementUiOptions,
  patch: (partial: SettlementUiSnapshot) => void
) => {
  const window = createReactSettlementWindow({
    className: "settlement-ui__building-details-window settlement-ui__bridge-details-window",
    contentClassName: "settlement-ui__overview",
    heading: translateMessage(options.i18n, M.bridge.title),
    id: "settlement-bridge-details-title",
    load: async visibility => (await import("./mount")).createBridgeDetailsMount(store, visibility, options),
    onClose: () => {
      patch({ focusedBridge: null });
      options.onCloseBridge?.();
    }
  });
  const focused = () => {
    const { bridges, focusedBridge } = store.getSnapshot();
    return focusedBridge ? bridges?.find(bridge => bridge.id === focusedBridge) : undefined;
  };
  const refreshTitle = () => window.setTitle(getBridgeDetailsTitle(focused(), options.i18n));
  return {
    close: window.close,
    dispose: window.dispose,
    focus: (id: number) => {
      patch({ focusedBridge: String(id) });
      options.onFocusBridge?.(id);
      refreshTitle();
      window.open();
    },
    refreshTitle,
    root: window.root,
    /** A removed bridge closes its panel; its title follows the bridge kind and the locale. */
    sync: () => {
      if (store.getSnapshot().focusedBridge && !focused() && window.isOpen()) window.close();
    }
  };
};
