import { useLingui } from "@lingui/react";
import { useSyncExternalStore } from "react";

import { translateMessage } from "../../../shared/i18n/translate";
import { pasteTrigger,readClipboard, subscribeClipboard } from "./clipboard";
import { TRIGGER_LIST_FILTERS, type TriggerListFilter } from "./constants";
import { SCRIPT_MESSAGES as M } from "./messages";
import { addFolder, addTrigger, moveTriggerToFolder, removeFolder, renameFolder } from "./script-document";
import type { ScriptWorkspace } from "./script-workspace";
import { nextItemNumber, triggerListRows } from "./trigger-list-helpers";
import { useDescribeContext, useIssueIndex, useWorkspaceState } from "./use-script-workspace";

const FILTER_LABELS: Readonly<Record<TriggerListFilter, typeof M.list.filterAll>> = {
  all: M.list.filterAll, disabled: M.list.filterDisabled, errors: M.list.filterErrors
};

const hasCopiedTrigger = () => readClipboard()?.kind === "trigger";

/** The trigger list's view model: toolbar texts, rows (folders and triggers) and the list commands. */
export const useTriggerList = (workspace: ScriptWorkspace, onOpenTemplates: () => void) => {
  const { i18n } = useLingui();
  const state = useWorkspaceState(workspace);
  const context = useDescribeContext(state);
  const issues = useIssueIndex(state);
  const hasClipboardTrigger = useSyncExternalStore(subscribeClipboard, hasCopiedTrigger, hasCopiedTrigger);
  const { script } = state;
  const selected = script.triggers.find(item => item.id === state.selectedTriggerId);
  const rows = triggerListRows(script, { context, filter: state.filter, issues, query: state.query,
    selectedId: state.selectedTriggerId }).map(row => {
    if (row.kind === "folder") return { ...row, label: row.id === null ? translateMessage(i18n, M.list.unsorted)
      : row.name };
    const name = row.enabled ? row.name : translateMessage(i18n, M.list.triggerOff, { name: row.name });
    const errors = row.errors ? translateMessage(i18n, M.list.errorCount, { count: row.errors }) : "";
    return { ...row, errorText: errors, label: name };
  });
  const empty = () => {
    if (rows.some(row => row.kind === "trigger")) return "";
    if (!script.triggers.length) return translateMessage(i18n, M.list.noTriggers);
    return translateMessage(i18n, M.list.noMatches, { query: state.query.trim() });
  };
  const addNewTrigger = () => {
    const name = translateMessage(i18n, M.list.newTrigger, { number: nextItemNumber(script.triggers) });
    const { script: next, trigger } = addTrigger(script, name, selected?.folderId ?? null);
    workspace.commit(next, { selectedTriggerId: trigger.id });
  };
  const addNewFolder = () => {
    const name = translateMessage(i18n, M.list.newFolder, { number: nextItemNumber(script.folders) });
    workspace.commit(addFolder(script, name).script);
  };
  const paste = () => {
    const pasted = pasteTrigger(script, selected?.folderId ?? null,
      name => translateMessage(i18n, M.list.copyName, { name }));
    if (pasted) workspace.commit(pasted.script, { selectedTriggerId: pasted.trigger.id });
  };
  return {
    addFolderLabel: translateMessage(i18n, M.list.addFolder),
    addTemplateLabel: translateMessage(i18n, M.list.addTemplate),
    addTriggerLabel: translateMessage(i18n, M.list.addTrigger),
    deleteFolderLabel: (name: string) => translateMessage(i18n, M.list.deleteFolder, { name }),
    emptyText: empty(),
    filter: state.filter,
    filterLabel: translateMessage(i18n, M.list.filter),
    filters: TRIGGER_LIST_FILTERS.map(id => ({ id, label: translateMessage(i18n, FILTER_LABELS[id]) })),
    folderNameLabel: translateMessage(i18n, M.list.folderName),
    hasClipboardTrigger,
    listLabel: translateMessage(i18n, M.list.triggers),
    pasteLabel: translateMessage(i18n, M.list.paste),
    query: state.query,
    rows,
    searchLabel: translateMessage(i18n, M.list.search),
    searchPlaceholder: translateMessage(i18n, M.list.searchPlaceholder),
    onAddFolder: addNewFolder,
    onAddTemplate: onOpenTemplates,
    onAddTrigger: addNewTrigger,
    onDeleteFolder: (id: string) => workspace.commit(removeFolder(script, id)),
    onDropTrigger: (triggerId: string, folderId: string | null) =>
      workspace.commit(moveTriggerToFolder(script, triggerId, folderId)),
    onFilterChange: (value: string) => workspace.setFilter(value as TriggerListFilter),
    onPaste: paste,
    onQueryChange: workspace.setQuery,
    onRenameFolder: (id: string, name: string) => workspace.commit(renameFolder(script, id, name)),
    onSelect: (id: string) => workspace.selectTrigger(id),
    onToggleTrigger: (id: string) => workspace.updateTrigger(id, trigger => ({ ...trigger, enabled: !trigger.enabled }))
  };
};

export type TriggerListView = ReturnType<typeof useTriggerList>;
