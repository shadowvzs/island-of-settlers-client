import { useLingui } from "@lingui/react";
import { useMemo, useState } from "react";

import type {
  CellFormat, MultiboardColumn, MultiboardDefinition
} from "../../../../../../island-of-settlers-shared/src/script/types/multiboards";
import type { QuestText } from "../../../../../../island-of-settlers-shared/src/script/types/quest-text";
import type { PlayerFilter } from "../../../../../../island-of-settlers-shared/src/script/types/refs";
import type { ScriptVariable } from "../../../../../../island-of-settlers-shared/src/script/types/script";
import { translateMessage } from "../../../../shared/i18n/translate";
import { getBoardView, getRowView } from "../../../script/multiboard/helpers";
import { multiboardTextContext } from "../../../script/multiboard/use-multiboards";
import { playerChoices } from "../picker-options";
import type { ScriptWorkspace } from "../script-workspace";
import { slotOpener } from "../slot-opener";
import type { ScriptDialogs } from "../use-script-dialogs";
import { useDescribeContext, useIssueIndex, useWorkspaceState } from "../use-script-workspace";
import { describeUsers } from "../users";
import { itemIssues } from "../validation";
import { removeVariable, replaceVariable, variableUsers } from "../variables/variable-edits";
import {
  addBoard, addColumn, addStaticRow, boardOf, boardSort, columnWidth, moveColumn, moveStaticRow, removeColumn,
  removeStaticRow, rowSource, setCellFormat, setColumn, setStaticRow, updateBoard
} from "./board-edits";
import { previewBoard } from "./board-preview";
import { NEW_BOARD_TEXTS, type RowSourceKind } from "./constants";
import { boardListRows, boardOptions, columnRows, listVariables, staticRowViews } from "./helpers";
import { BOARD_MESSAGES as M } from "./messages";

type BoardChange = (board: MultiboardDefinition) => MultiboardDefinition;

/** The board editor's preview: the engine's snapshot prepared like the game's board window. */
const usePreview = (variables: readonly ScriptVariable[], script: Parameters<typeof previewBoard>[0],
  boardId: string | null) => {
  const { i18n } = useLingui();
  const { locale } = i18n;
  // The script identity changes on every commit; the variables decide what the board shows.
  // oxlint-disable-next-line react/exhaustive-deps
  const snapshot = useMemo(() => (boardId ? previewBoard(script, boardId) : null), [variables, boardId]);
  return useMemo(() => {
    if (!snapshot) return null;
    const context = multiboardTextContext(i18n);
    return getBoardView(snapshot, false, snapshot.rows.map(row => getRowView(row, snapshot.columns, context)),
      context);
  // oxlint-disable-next-line react/exhaustive-deps
  }, [snapshot, i18n, locale]);
};

/** The Multiboards tab (design §13.5): board list, the selected board's fields, columns, rows and preview. */
export const useBoardPanel = (workspace: ScriptWorkspace, dialogs: ScriptDialogs) => {
  const { i18n } = useLingui();
  const state = useWorkspaceState(workspace);
  const context = useDescribeContext(state);
  const issueIndex = useIssueIndex(state);
  const { script } = state;
  const [selected, setSelected] = useState<string | null>(null);
  const boards = boardListRows(script.variables, selected, i18n);
  const selectedId = boards.find(row => row.selected)?.id ?? boards[0]?.id ?? null;
  const variable = script.variables.find(item => item.id === selectedId);
  const board = boardOf(variable);
  const text = (descriptor: Parameters<typeof translateMessage>[1], values?: Record<string, string | number>) =>
    translateMessage(i18n, descriptor, values);
  const change = (edit: BoardChange) => {
    if (selectedId) workspace.commit(updateBoard(workspace.getSnapshot().script, selectedId, edit));
  };
  const updateVariable = (edit: (value: ScriptVariable) => ScriptVariable) => {
    const current = workspace.getSnapshot().script.variables.find(item => item.id === selectedId);
    if (current) workspace.commit(replaceVariable(workspace.getSnapshot().script, edit(current)));
  };
  const issues = variable ? itemIssues(issueIndex, "variable", script.variables.indexOf(variable)) : [];
  const users = selectedId ? variableUsers(script, selectedId) : [];
  const preview = usePreview(script.variables, script, selectedId);
  return {
    board,
    boards: boards.map(row => ({ ...row, selected: row.id === selectedId })),
    columns: board ? columnRows(board, context, issues) : [],
    issues: issues.filter(issue => issue.path[2] !== "cells"),
    labels: {
      add: text(M.add), addColumn: text(M.addColumn), addRow: text(M.addRow), align: text(M.align),
      audience: text(M.audience), collapsed: text(M.collapsed), columns: text(M.columns), delete: text(M.delete),
      empty: text(M.empty), format: text(M.format), header: text(M.header), info: text(M.info), list: text(M.list),
      maxRows: text(M.maxRows), none: text(M.none), players: text(M.players), preview: text(M.preview),
      previewUnavailable: text(M.previewUnavailable), rowIcon: text(M.rowIcon), rowLabel: text(M.rowLabel),
      rowList: text(M.rowList), rows: text(M.rows), sort: text(M.sort),
      tab: text(M.tab), title: text(M.title), unsorted: text(M.unsorted), variable: text(M.variable),
      visible: text(M.visible), width: text(M.width), widthAuto: text(M.widthAuto),
      widthShort: text(M.widthShort)
    },
    lists: listVariables(script.variables).map(item => ({ key: item.id, label: item.name })),
    name: variable?.name ?? "",
    options: boardOptions(i18n),
    players: playerChoices(false, context).map(choice => ({ key: choice.key, label: choice.label })),
    preview,
    selectedId,
    staticRows: board ? staticRowViews(board, context) : [],
    usedBy: users.length ? text(M.usedBy, { users: describeUsers(users, context) }) : text(M.unused),
    onAdd: () => {
      const added = addBoard(workspace.getSnapshot().script, NEW_BOARD_TEXTS);
      if (workspace.commit(added.script)) setSelected(added.id);
    },
    onAddColumn: () => change(current => addColumn(current, NEW_BOARD_TEXTS.column)),
    onAddRow: () => change(current => addStaticRow(current, NEW_BOARD_TEXTS.row)),
    onAudience: (key: string) => change(current => ({ ...current, audience: JSON.parse(key) as PlayerFilter })),
    onCellFormat: (columnId: string, format: string) =>
      change(current => setCellFormat(current, columnId, format as CellFormat)),
    onColumn: (columnId: string, field: Partial<MultiboardColumn>) =>
      change(current => setColumn(current, columnId, field)),
    onColumnWidth: (columnId: string, width: string) =>
      change(current => setColumn(current, columnId, { width: columnWidth(width) })),
    onDelete: () => {
      if (!variable) return;
      const result = removeVariable(workspace.getSnapshot().script, variable.id);
      if (result.changed) { workspace.commit(result.script); return; }
      workspace.setNotice(translateMessage(i18n, M.usedBy, { users: describeUsers(result.users, context) }), true);
    },
    onField: (field: Partial<MultiboardDefinition>) => change(current => ({ ...current, ...field })),
    onListSource: (id: string) => change(current => (current.rows.kind === "array"
      ? { ...current, rows: { ...current.rows, lengthOf: { id, k: "ref", kind: "variable" } } } : current)),
    onMaxRows: (text: string) => change(current => (current.rows.kind === "array" && Number(text) >= 1
      ? { ...current, rows: { ...current.rows, maxRows: Math.round(Number(text)) } } : current)),
    onMoveColumn: (columnId: string, offset: number) => change(current => moveColumn(current, columnId, offset)),
    onMoveRow: (rowId: string) => change(current => moveStaticRow(current, rowId, -1)),
    onName: (name: string) => updateVariable(current => ({ ...current, name: name.trim() })),
    onOpenSlot: slotOpener<ScriptVariable>(i18n, dialogs, updateVariable),
    onPlayersFilter: (key: string) => change(current => (current.rows.kind === "players"
      ? { ...current, rows: { filter: JSON.parse(key) as PlayerFilter, kind: "players" } } : current)),
    onRemoveColumn: (columnId: string) => change(current => removeColumn(current, columnId)),
    onRemoveRow: (rowId: string) => change(current => removeStaticRow(current, rowId)),
    onRowLabel: (rowId: string, label: QuestText) => change(current => setStaticRow(current, rowId, { label })),
    onRowSource: (kind: string) => change(current => ({ ...current,
      rows: rowSource(kind as RowSourceKind, current, listVariables(workspace.getSnapshot().script.variables)) })),
    onSelect: setSelected,
    onSort: (columnId: string, direction: string) => change(current => ({ ...current,
      sort: boardSort(columnId, direction) }))
  };
};

export type BoardPanelView = ReturnType<typeof useBoardPanel>;
