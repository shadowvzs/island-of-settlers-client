import { useLingui } from "@lingui/react";
import { useMemo, useState } from "react";

import { isDeepEqual } from "../../components/ui-store";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiStore } from "../ui-store";
import { useWindowSelector } from "../use-window-selector";
import { getBridgeDetailsView, selectBridgeDetails } from "./helpers";

/**
 * The focused bridge, its prepared view and the panel-local remove question. The question belongs to
 * one visible bridge: focusing another bridge or hiding the window drops it.
 */
export const useBridgeDetails = (store: SettlementUiStore, visibility: SettlementWindowVisibilityStore) => {
  const { i18n } = useLingui();
  const { selection, visible } = useWindowSelector(store, visibility, selectBridgeDetails, isDeepEqual);
  const bridge = selection.bridge;
  const view = useMemo(() => bridge && getBridgeDetailsView(bridge, i18n), [bridge, i18n]);
  const [asked, setAsked] = useState<string | null>(null);
  return {
    asking: visible && asked !== null && asked === bridge?.id,
    bridge,
    view,
    visible,
    askRemoval: () => setAsked(bridge?.id ?? null),
    keep: () => setAsked(null)
  };
};
