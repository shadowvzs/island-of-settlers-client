import { useLingui } from "@lingui/react";
import { useMemo, useState, useSyncExternalStore } from "react";

import { translateMessage } from "../../../shared/i18n/translate";
import { resolveEditorText } from "../messages";
import type { ScriptLinkTab } from "./constants";
import { type DescribeContext, scriptExitOptions } from "./describe";
import { SCRIPT_MESSAGES as M } from "./messages";
import { BOARD_MESSAGES } from "./multiboards/messages";
import { QUEST_MESSAGES } from "./quests/messages";
import type { ScriptWorkspace, ScriptWorkspaceState } from "./script-workspace";
import { indexIssues } from "./validation";
import { VARIABLE_MESSAGES } from "./variables/messages";

/** The workspace state (one subscription per view; snapshots change only on commits and selections). */
export const useWorkspaceState = (workspace: ScriptWorkspace): ScriptWorkspaceState =>
  useSyncExternalStore(workspace.subscribe, workspace.getSnapshot, workspace.getSnapshot);

/** The describe context of the active locale and script. */
export const useDescribeContext = (state: ScriptWorkspaceState): DescribeContext => {
  const { i18n } = useLingui();
  const { locale } = i18n;
  const { audioAssets, campaignMap, mapExits, script } = state;
  return useMemo(() => ({
    ...(campaignMap ? { exits: scriptExitOptions(mapExits ?? [], locale) } : {}), audioAssets, i18n, locale, script
  }), [audioAssets, campaignMap, i18n, locale, mapExits, script]);
};

/** Issues of the current validation, formatted in the active locale (recomputed only when either changes). */
export const useIssueIndex = (state: ScriptWorkspaceState) => {
  const { i18n } = useLingui();
  const { locale } = i18n;
  return useMemo(() => indexIssues(state.validation, locale), [locale, state.validation]);
};

/** The workspace header: validation status, notice and undo/redo. */
export const useWorkspaceHeader = (workspace: ScriptWorkspace) => {
  const { i18n } = useLingui();
  const state = useWorkspaceState(workspace);
  const { errors, warnings } = state.validation;
  const statusText = () => {
    if (errors.length) return translateMessage(i18n, M.workspace.draft, { errors: errors.length,
      warnings: warnings.length });
    if (warnings.length) return translateMessage(i18n, M.workspace.warningsOnly, { warnings: warnings.length });
    return translateMessage(i18n, M.workspace.ready);
  };
  return {
    canRedo: state.canRedo,
    canTestPlay: workspace.canTestPlay,
    canUndo: state.canUndo,
    notice: resolveEditorText(i18n, state.notice),
    noticeIsRefusal: state.noticeIsRefusal,
    ready: errors.length === 0,
    redoLabel: translateMessage(i18n, M.workspace.redo),
    status: statusText(),
    tabRequest: state.focus && { id: state.focus.tab, revision: state.focus.revision },
    tabsLabel: translateMessage(i18n, M.workspace.tabs),
    tabs: {
      actors: translateMessage(i18n, M.workspace.tabActors),
      boards: translateMessage(i18n, BOARD_MESSAGES.tab),
      quests: translateMessage(i18n, QUEST_MESSAGES.tab),
      triggers: translateMessage(i18n, M.workspace.tabTriggers),
      variables: translateMessage(i18n, VARIABLE_MESSAGES.tab)
    },
    testPlayLabel: translateMessage(i18n, M.workspace.testPlay),
    undoLabel: translateMessage(i18n, M.workspace.undo),
    onRedo: workspace.redo,
    onTestPlay: workspace.testPlay,
    onUndo: workspace.undo
  };
};

/**
 * The item of a tab a deep link names, applied once per request (the `useTabs` request pattern): `onFocus` receives
 * the id when a new request for `tab` arrives.
 */
export const useFocusRequest = (state: ScriptWorkspaceState, tab: ScriptLinkTab, onFocus: (id: string) => void) => {
  const [applied, setApplied] = useState(0);
  const { focus } = state;
  if (!focus || focus.revision === applied) return;
  setApplied(focus.revision);
  if (focus.tab === tab && focus.itemId) onFocus(focus.itemId);
};

/** The selected trigger of the current script (undefined when none is selected). */
export const useSelectedTrigger = (workspace: ScriptWorkspace) => {
  const state = useWorkspaceState(workspace);
  return state.script.triggers.find(item => item.id === state.selectedTriggerId);
};
