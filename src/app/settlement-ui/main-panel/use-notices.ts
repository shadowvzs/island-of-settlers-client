import { useLingui } from "@lingui/react";
import { useMemo } from "react";

import { isDeepEqual } from "../../components/ui-store";
import { useStoreSelector } from "../../components/use-store-selector";
import type { SettlementUiStore } from "../ui-store";
import { selectNoticeRows } from "./helpers";
import type { MainPanelVisibilityStore } from "./main-panel";
import { useMainPanelView } from "./use-main-panel-view";

/** Notification rows, recomputed only while the Notifications view is shown. */
export const useNotices = (panel: MainPanelVisibilityStore, store: SettlementUiStore) => {
  const { i18n } = useLingui();
  const select = useMemo(() => (snapshot: Parameters<typeof selectNoticeRows>[0]) => selectNoticeRows(snapshot, i18n),
    [i18n]);
  const rows = useStoreSelector(store, select, isDeepEqual, useMainPanelView(panel, "notices"), i18n.locale);
  return { empty: rows.length === 0, rows };
};
