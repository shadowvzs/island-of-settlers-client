import { useLingui } from "@lingui/react";
import { useMemo } from "react";

import { translateMessage } from "../../../shared/i18n/translate";
import { SettlementIcon } from "../../components/settlement-icon";
import { useI18nRevision } from "../../components/use-i18n-revision";
import { CatalogVersionWarning } from "../catalog-version/catalog-version-warning";
import type { EditorTabId } from "../editor-catalog";
import type { EditorPanelControllers } from "../editor-panel";
import { MAP_EDITOR_MESSAGES as M } from "../messages";
import { BrushSection, EditorStatus, EditorTabList, EditorTabPanels, HistoryBar } from "./editor-shell";
import { createTabContents } from "./editor-tabs";
import { useEditorTabs } from "./use-editor-store";

/** Tabs whose controls edit with the shared brush size/strength. */
const BRUSH_TABS: ReadonlySet<EditorTabId> = new Set(["deposits", "objects", "terrain", "tiles", "trees"]);

/**
 * The map editor panel: title, history and category tabs on a sticky toolbar, the shared brush where
 * it applies, the categories (one live copy of each control; changing category puts the previous tool
 * away), help and the hint line.
 */
export const EditorPanel = (controllers: EditorPanelControllers) => {
  const { i18n } = useLingui();
  useI18nRevision(i18n);
  const { close, store, world } = controllers;
  const { tabs, onTabKeyDown, onTabSelect } = useEditorTabs(store, world);
  const contents = useMemo(() => createTabContents(controllers), [controllers]);
  const activeTab = tabs.find(tab => tab.selected)?.content;
  return (
    <>
      <div className="map-editor__toolbar">
        <div className="map-editor__header">
          <h2>{translateMessage(i18n, M.common.title)}</h2>
          <HistoryBar history={controllers.history} />
          <button aria-label={translateMessage(i18n, M.common.close)} className="map-editor__close"
            title={translateMessage(i18n, M.common.close)} type="button" onClick={close}>
            <SettlementIcon name="cancel" />
          </button>
        </div>
        <EditorTabList tabs={tabs} onTabKeyDown={onTabKeyDown} onTabSelect={onTabSelect} />
      </div>
      <CatalogVersionWarning warning={controllers.catalogWarning} />
      {activeTab && BRUSH_TABS.has(activeTab) && <BrushSection store={store} />}
      <EditorTabPanels contents={contents} tabs={tabs} />
      <p className="map-editor__help">{translateMessage(i18n, M.common.moveHelp)}</p>
      <EditorStatus store={store} />
    </>
  );
};
