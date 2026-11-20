import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { createLazyReactContent } from "../../components/lazy-react-content";
import { createExternalStore } from "../../components/ui-store";
import { readColoniesCollapsed, storeColoniesCollapsed } from "../colony-helpers";
import { makeSettlementPanelDraggable } from "../drag";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementPopupContent } from "../settlement-popup";
import type { SettlementUiOptions } from "../types";
import type { SettlementUiStore } from "../ui-store";
import { hasColonyTrackerContent } from "./helpers";

import "../colony.css";

/**
 * Small draggable right-side tracker of expeditions, colonies and adventures. The DOM frame keeps the
 * drag handle, visibility (hidden while empty) and the session-remembered collapse; React renders the
 * handle's icon, heading and toggle (portal) and the body, loading on the first expedition.
 */
export const createColonyTracker = (
  store: SettlementUiStore, options: SettlementUiOptions, confirm: (popup: SettlementPopupContent) => void,
  i18n?: I18n
) => {
  const root = document.createElement("aside");
  root.className = "settlement-ui__panel colony-tracker";
  root.hidden = true;
  const refreshLabels = () => {
    root.setAttribute("aria-label", translateMessage(i18n, M.colony.trackerAria));
    handle.setAttribute("aria-label", translateMessage(i18n, M.colony.trackerMove));
  };
  const handle = document.createElement("div");
  handle.className = "colony-tracker__handle";
  handle.tabIndex = 0;
  handle.setAttribute("role", "button");
  refreshLabels();
  const body = document.createElement("div");
  body.className = "colony-tracker__body";
  root.append(handle, body);
  const collapsed = createExternalStore(readColoniesCollapsed());
  const showCollapsed = () => {
    body.hidden = collapsed.getSnapshot();
    root.classList.toggle("is-collapsed", body.hidden);
  };
  const toggleCollapsed = () => {
    storeColoniesCollapsed(!collapsed.getSnapshot());
    collapsed.set(!collapsed.getSnapshot());
    showCollapsed();
  };
  showCollapsed();
  const drag = makeSettlementPanelDraggable(root, handle);
  const content = createLazyReactContent(body, translateMessage(i18n, M.colony.coloniesAria),
    async () => (await import("./mount"))
      .createColonyTrackerMount({ collapsed, confirm, handle, options, store, toggleCollapsed }), {
      error: name => translateMessage(i18n, M.common.loadFailed, { name }),
      loading: name => translateMessage(i18n, M.common.loading, { name })
    });
  const sync = () => {
    root.hidden = !hasColonyTrackerContent(store.getSnapshot(), Boolean(options.onReturnHome));
    if (root.hidden) return;
    content.mount();
    drag.constrain();
  };
  const unsubscribe = store.subscribe(sync);
  sync();
  return {
    refreshLabels,
    root,
    /** Script `openUi`/`closeUi` (TRG9): expands or collapses a shown tracker; false while it has no content. */
    setCollapsed: (value: boolean) => {
      if (root.hidden) return false;
      if (collapsed.getSnapshot() !== value) toggleCollapsed();
      return true;
    },
    dispose: () => {
      unsubscribe();
      content.unmount();
      drag.dispose();
      root.remove();
    }
  };
};
