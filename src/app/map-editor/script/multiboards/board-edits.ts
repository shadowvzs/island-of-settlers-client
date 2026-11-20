import type {
  CellFormat, MultiboardCell, MultiboardColumn, MultiboardDefinition, MultiboardStaticRow
} from "../../../../../../island-of-settlers-shared/src/script/types/multiboards";
import type { QuestText } from "../../../../../../island-of-settlers-shared/src/script/types/quest-text";
import type { MapScript, ScriptVariable } from "../../../../../../island-of-settlers-shared/src/script/types/script";
import type { Expr } from "../../../../../../island-of-settlers-shared/src/script/types/values";
import { UNSET_OPERAND_ID } from "../constants";
import { numberLiteral, UNSET_OPERAND } from "../factory";
import { moveListItem } from "../script-document";
import { addVariable, replaceVariable } from "../variables/variable-edits";
import {
  BOARD_VIEWER_FACTION, COLUMN_ID_PREFIX, DEFAULT_ARRAY_ROWS, NEW_BOARD_NAME, NUMBER_COLUMN_WIDTH, ROW_ID_PREFIX,
  type RowSourceKind
} from "./constants";

/**
 * Pure edits of a multiboard (design §4.11, §13.5): title, start state, audience, row source (static rows, one
 * per player, one per list item), columns with their cells and the sort. A board is a map variable.
 */

/** The texts a new board needs (in the editor's language; the author translates them). */
export interface NewBoardTexts {
  row: QuestText;
  rowHeader: QuestText;
  title: QuestText;
  valueHeader: QuestText;
}

const ROW_LABEL: Expr = { k: "cell", key: "rowLabel" };

/** A board with one static row: a label column (the row label) and a number column the author fills. */
export const createBoard = (texts: NewBoardTexts): MultiboardDefinition => ({
  audience: { faction: BOARD_VIEWER_FACTION, kind: "slot" },
  cells: { c1: { expr: ROW_LABEL, format: "text" }, c2: { expr: numberLiteral(0), format: "number" } },
  columns: [{ align: "left", header: texts.rowHeader, id: "c1", width: "auto" },
    { align: "right", header: texts.valueHeader, id: "c2", width: NUMBER_COLUMN_WIDTH }],
  initiallyCollapsed: false,
  initiallyVisible: false,
  rows: { kind: "static", rows: [{ id: "r1", label: texts.row }] },
  sort: null,
  title: texts.title
});

/** Adds a board variable; returns its id. */
export const addBoard = (script: MapScript, texts: NewBoardTexts) => {
  const added = addVariable(script, "multiboard", NEW_BOARD_NAME);
  const board: ScriptVariable = { ...added.variable, initial: { type: "multiboard", value: createBoard(texts) } };
  return { id: board.id, script: replaceVariable(added.script, board) };
};

/** The board of a variable (null for any other variable). */
export const boardOf = (variable: ScriptVariable | undefined): MultiboardDefinition | null =>
  (variable?.initial.type === "multiboard" ? variable.initial.value : null);

/** Replaces a board's definition through a change function. */
export const updateBoard = (script: MapScript, id: string,
  change: (board: MultiboardDefinition) => MultiboardDefinition): MapScript => {
  const variable = script.variables.find(item => item.id === id);
  const board = boardOf(variable);
  if (!variable || !board) return script;
  return replaceVariable(script, { ...variable, initial: { type: "multiboard", value: change(board) } });
};

const freeId = (prefix: string, used: readonly string[]) => {
  let number = used.length + 1;
  while (used.includes(`${prefix}${number}`)) number += 1;
  return `${prefix}${number}`;
};

/** The cell a format starts with; switching keeps the expression (a fraction's current value). */
export const cellWithFormat = (cell: MultiboardCell | undefined, format: CellFormat): MultiboardCell => {
  const expr = cell ? cellExpression(cell) : UNSET_OPERAND;
  if (format === "fraction") return { current: expr, format, target: numberLiteral(1) };
  return { expr, format };
};

const cellExpression = (cell: MultiboardCell) => ("expr" in cell ? cell.expr : cell.current);

export const addColumn = (board: MultiboardDefinition, header: QuestText): MultiboardDefinition => {
  const id = freeId(COLUMN_ID_PREFIX, board.columns.map(column => column.id));
  return { ...board, cells: { ...board.cells, [id]: { expr: UNSET_OPERAND, format: "number" } },
    columns: [...board.columns, { align: "right", header, id, width: NUMBER_COLUMN_WIDTH }] };
};

/** Removes a column with its cell (and the sort that used it). */
export const removeColumn = (board: MultiboardDefinition, columnId: string): MultiboardDefinition => {
  const { [columnId]: _removed, ...cells } = board.cells;
  return { ...board, cells, columns: board.columns.filter(column => column.id !== columnId),
    sort: board.sort?.columnId === columnId ? null : board.sort };
};

export const moveColumn = (board: MultiboardDefinition, columnId: string, offset: number): MultiboardDefinition =>
  ({ ...board, columns: moveListItem(board.columns, board.columns.findIndex(column => column.id === columnId),
    offset) });

export const setColumn = (board: MultiboardDefinition, columnId: string,
  change: Partial<MultiboardColumn>): MultiboardDefinition =>
  ({ ...board, columns: board.columns.map(column => (column.id === columnId ? { ...column, ...change } : column)) });

export const setCellFormat = (board: MultiboardDefinition, columnId: string, format: CellFormat) =>
  ({ ...board, cells: { ...board.cells, [columnId]: cellWithFormat(board.cells[columnId], format) } });

/** A width from its input: a positive number of pixels, else "auto". */
export const columnWidth = (text: string): MultiboardColumn["width"] => {
  const width = Math.round(Number(text));
  return Number.isFinite(width) && width > 0 ? width : "auto";
};

/** The row source of a kind; a list source reads the first list variable (unset when there is none). */
export const rowSource = (kind: RowSourceKind, board: MultiboardDefinition,
  arrays: readonly ScriptVariable[]): MultiboardDefinition["rows"] => {
  if (kind === board.rows.kind) return board.rows;
  if (kind === "players") return { filter: { kind: "any" }, kind };
  if (kind === "array") return { kind, lengthOf: { id: arrays[0]?.id ?? UNSET_OPERAND_ID, k: "ref",
    kind: "variable" }, maxRows: DEFAULT_ARRAY_ROWS };
  return { kind, rows: [] };
};

const staticRows = (board: MultiboardDefinition) => (board.rows.kind === "static" ? board.rows.rows : []);

const withStaticRows = (board: MultiboardDefinition, rows: MultiboardStaticRow[]): MultiboardDefinition =>
  ({ ...board, rows: { kind: "static", rows } });

export const addStaticRow = (board: MultiboardDefinition, label: QuestText) => {
  const rows = staticRows(board);
  return withStaticRows(board, [...rows, { id: freeId(ROW_ID_PREFIX, rows.map(row => row.id)), label }]);
};

export const removeStaticRow = (board: MultiboardDefinition, rowId: string) =>
  withStaticRows(board, staticRows(board).filter(row => row.id !== rowId));

export const moveStaticRow = (board: MultiboardDefinition, rowId: string, offset: number) => {
  const rows = staticRows(board);
  return withStaticRows(board, moveListItem(rows, rows.findIndex(row => row.id === rowId), offset));
};

export const setStaticRow = (board: MultiboardDefinition, rowId: string, change: Partial<MultiboardStaticRow>) =>
  withStaticRows(board, staticRows(board).map(row => {
    if (row.id !== rowId) return row;
    const next = { ...row, ...change };
    if (!next.icon) delete next.icon;
    return next;
  }));

/** The sort from its two selects ("" = unsorted). */
export const boardSort = (columnId: string, direction: string): MultiboardDefinition["sort"] =>
  (columnId ? { columnId, direction: direction === "asc" ? "asc" : "desc" } : null);
