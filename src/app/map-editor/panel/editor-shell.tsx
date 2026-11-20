import { useLingui } from "@lingui/react";
import type { KeyboardEvent, ReactNode } from "react";

import { translateMessage } from "../../../shared/i18n/translate";
import { Section } from "../../components/section";
import { LevelSlider } from "../../components/slider";
import { type EditorTabId,HISTORY_ACTIONS } from "../editor-catalog";
import type { EditorHistory } from "../editor-history";
import type { EditorStore } from "../editor-store";
import { MAP_EDITOR_MESSAGES as M } from "../messages";
import { IconImage, StatusText, ToolButton } from "./fields";
import {
type EditorTabRow,
  getBrushSizeLevels, getBrushStrengthLevels} from "./helpers";
import { useBrush, useEditorStatus } from "./use-editor-store";
import { useHistoryState } from "./use-history";

const HISTORY_BUTTON_CLASS = "map-editor__tool map-editor__history-button";

interface HistoryBarProps {
  history: EditorHistory;
}
/** Undo and redo (disabled when there is nothing to undo or redo). */
export const HistoryBar = ({ history }: HistoryBarProps) => {
  const { canRedo, canUndo } = useHistoryState(history);
  const { i18n } = useLingui();
  return (
    <div aria-label={translateMessage(i18n, M.common.editHistory)} className="map-editor__history" role="toolbar">
      <ToolButton action={HISTORY_ACTIONS.undo} className={HISTORY_BUTTON_CLASS} disabled={!canUndo}
        onClick={history.undo} />
      <ToolButton action={HISTORY_ACTIONS.redo} className={HISTORY_BUTTON_CLASS} disabled={!canRedo}
        onClick={history.redo} />
    </div>
  );
};

interface EditorTabListProps {
  tabs: readonly EditorTabRow[];
  onTabKeyDown: (event: KeyboardEvent<HTMLButtonElement>, index: number) => void;
  onTabSelect: (index: number) => void;
}
/** The category tabs: icon, short caption, full name as tooltip and accessible name. */
export const EditorTabList = ({ tabs, onTabKeyDown, onTabSelect }: EditorTabListProps) => {
  const { i18n } = useLingui();
  return (
    <div aria-label={translateMessage(i18n, M.common.categories)} className="map-editor__tabs" role="tablist">
      {tabs.map(tab => (
        <button
          aria-controls={tab.panelId}
          aria-label={tab.name}
          aria-selected={tab.selected}
          className={tab.className}
          id={tab.tabId}
          key={tab.id}
          role="tab"
          tabIndex={tab.tabIndex}
          title={tab.name}
          type="button"
          onClick={() => onTabSelect(tab.index)}
          onKeyDown={event => onTabKeyDown(event, tab.index)}
        >
          {tab.icon && <IconImage icon={tab.icon} />}
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
};

interface EditorTabPanelsProps {
  contents: Readonly<Record<EditorTabId, ReactNode>>;
  tabs: readonly EditorTabRow[];
}
/** Every category stays mounted (one live copy of each control); hidden ones keep their values. */
export const EditorTabPanels = ({ contents, tabs }: EditorTabPanelsProps) => (
  <div>
    {tabs.map(tab => (
      <div aria-labelledby={tab.tabId} className="map-editor__tab-panel" hidden={!tab.selected} id={tab.panelId}
        key={tab.id} role="tabpanel">
        {contents[tab.content]}
      </div>
    ))}
  </div>
);

interface StoreProps {
  store: EditorStore;
}
/** Brush size and strength shared by every brush tool. */
export const BrushSection = ({ store }: StoreProps) => {
  const { i18n } = useLingui();
  const { sizeLevel, strengthLevel, onSizeInput, onStrengthInput } = useBrush(store);
  return (
    <Section title={translateMessage(i18n, M.brush.title)}>
      <LevelSlider label={translateMessage(i18n, M.brush.size)} level={sizeLevel}
        levels={getBrushSizeLevels(i18n)} onInput={onSizeInput} />
      <LevelSlider label={translateMessage(i18n, M.brush.strength)} level={strengthLevel}
        levels={getBrushStrengthLevels(i18n)} onInput={onStrengthInput} />
    </Section>
  );
};

/** The hint line: a refused edit (warning tone) or a notice; hidden when empty. */
export const EditorStatus = ({ store }: StoreProps) => {
  const { className, hidden, text } = useEditorStatus(store);
  return <StatusText className={className} hidden={hidden}>{text}</StatusText>;
};
