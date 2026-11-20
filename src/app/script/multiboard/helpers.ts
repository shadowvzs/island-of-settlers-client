import type {
  MultiboardCellSnapshot, MultiboardColumn, MultiboardRowSnapshot, MultiboardSnapshot
} from "../../../../../island-of-settlers-shared/src/script/types/multiboards";
import type { QuestText } from "../../../../../island-of-settlers-shared/src/script/types/quest-text";
import { joinClassNames } from "../../components/helpers";
import {
  ALIGN_CLASSES, BOARD_CLASS, BOOLEAN_CELL_TEXT, CLOCK_DIGITS, COLLAPSED_BOARD_CLASS, NUMBER_FRACTION_DIGITS,
  PERCENT_SCALE, REMEMBERED_TOGGLE_LIMIT, SECONDS_PER_HOUR, SECONDS_PER_MINUTE
} from "./constants";

/** Pure view transforms of the multiboards: cell formatting, prepared rows and the collapse rules. */

/** A header toggle of the player; it applies while the script has not collapsed/expanded the board since. */
export interface LocalCollapse {
  collapsed: boolean;
  revision: number;
}

/** Remembered toggles by `collapseKey`, oldest first. */
export type LocalCollapseMap = Readonly<Record<string, LocalCollapse>>;

/** What the formatting needs from the active locale; texts of map data are resolved by `text`. */
export interface BoardTextContext {
  collapseLabel: (title: string) => string;
  expandLabel: (title: string) => string;
  iconUrl: (contentId: string) => string | null;
  locale: string;
  text: (text: QuestText) => string;
}

export interface BoardColumnView {
  className: string;
  header: string;
  id: string;
  style: { width: number } | undefined;
}

export interface BoardCellView {
  className: string;
  icon: string | null;
  id: string;
  text: string;
}

export interface BoardRowView {
  cells: readonly BoardCellView[];
  id: string;
}

export interface BoardView {
  bodyId: string;
  className: string;
  collapsed: boolean;
  columns: readonly BoardColumnView[];
  expanded: boolean;
  hasHeaders: boolean;
  id: string;
  revision: number;
  rows: readonly BoardRowView[];
  title: string;
  toggleIcon: "collapse" | "expand";
  toggleLabel: string;
}

const isLocalCollapse = (value: unknown): value is LocalCollapse =>
  typeof value === "object" && value !== null && typeof (value as LocalCollapse).collapsed === "boolean"
  && Number.isInteger((value as LocalCollapse).revision);

/** Stored toggles; anything unreadable is no toggle at all. */
export const parseLocalCollapse = (raw: string | null): LocalCollapseMap => {
  if (!raw) return {};
  try {
    const stored: unknown = JSON.parse(raw);
    if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored).filter(([, value]) => isLocalCollapse(value))
      .slice(-REMEMBERED_TOGGLE_LIMIT)) as LocalCollapseMap;
  } catch {
    return {};
  }
};

export const formatLocalCollapse = (toggles: LocalCollapseMap) => JSON.stringify(toggles);

export const collapseKey = (scope: string, boardId: string) => `${scope}/${boardId}`;

/** The player's toggle wins until the next script collapse/expand action (a newer `collapseRevision`). */
export const isBoardCollapsed = (board: MultiboardSnapshot, local: LocalCollapse | undefined) => {
  if (local && local.revision === board.collapseRevision) return local.collapsed;
  return board.collapsed;
};

/** The toggles with one board set (moved to the newest end); the oldest beyond the limit are forgotten. */
export const withLocalCollapse = (toggles: LocalCollapseMap, key: string, toggle: LocalCollapse): LocalCollapseMap => {
  const others = Object.entries(toggles).filter(([entryKey]) => entryKey !== key);
  return Object.fromEntries([...others, [key, toggle] as const].slice(-REMEMBERED_TOGGLE_LIMIT));
};

/**
 * Phone: at most one board is expanded, the one the player opened last, else the first expanded one; the others
 * show only their header. Returns that board's id (null: all collapsed).
 */
export const phoneExpandedBoard = (expandedIds: readonly string[], focusedId: string | null) => {
  if (focusedId !== null && expandedIds.includes(focusedId)) return focusedId;
  return expandedIds[0] ?? null;
};

const numberFormats = new Map<string, Intl.NumberFormat>();
const numberFormat = (locale: string, style: "decimal" | "percent") => {
  const key = `${locale}/${style}`;
  let format = numberFormats.get(key);
  if (!format) {
    const maximumFractionDigits = style === "percent" ? 0 : NUMBER_FRACTION_DIGITS;
    numberFormats.set(key, format = new Intl.NumberFormat(locale, { maximumFractionDigits, style }));
  }
  return format;
};

const formatNumber = (value: number, locale: string) => numberFormat(locale, "decimal").format(value);

const clockPart = (value: number) => String(value).padStart(CLOCK_DIGITS, "0");

/** Whole seconds as `mm:ss`, from one hour on as `h:mm:ss`; a countdown never shows a negative time. */
export const formatCountdown = (seconds: number) => {
  const total = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(total / SECONDS_PER_HOUR);
  const minutes = clockPart(Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE));
  const rest = clockPart(total % SECONDS_PER_MINUTE);
  if (hours > 0) return `${hours}:${minutes}:${rest}`;
  return `${minutes}:${rest}`;
};

const formatNumeric = (format: MultiboardCellSnapshot["format"], value: number, locale: string) => {
  if (format === "countdown") return formatCountdown(value);
  if (format === "percent") return numberFormat(locale, "percent").format(value / PERCENT_SCALE);
  return formatNumber(value, locale);
};

/** One cell as text: "3 / 8", "1,250", "75%", "02:05", a translated text; an empty cell is an empty string. */
export const formatCell = (cell: MultiboardCellSnapshot, context: Pick<BoardTextContext, "locale" | "text">) => {
  if (cell.format === "fraction") {
    return `${formatNumber(cell.current, context.locale)} / ${formatNumber(cell.target, context.locale)}`;
  }
  const { value } = cell;
  if (value === null) return "";
  if (typeof value === "number") return formatNumeric(cell.format, value, context.locale);
  if (typeof value === "boolean") return BOOLEAN_CELL_TEXT[`${value}`];
  if (typeof value === "string") return value;
  return context.text(value);
};

/** The column showing the row icon: the first `iconNumber` column, else the first column. */
const iconColumn = (row: MultiboardRowSnapshot) =>
  Math.max(0, row.cells.findIndex(cell => cell.format === "iconNumber"));

const numericClass = (cell: MultiboardCellSnapshot) =>
  cell.format !== "text" && "multiboard__cell--numeric";

export const getRowView = (
  row: MultiboardRowSnapshot, columns: readonly MultiboardColumn[], context: BoardTextContext
): BoardRowView => {
  const iconAt = iconColumn(row);
  const icon = row.icon === null ? null : context.iconUrl(row.icon);
  return {
    cells: row.cells.map((cell, index) => ({
      className: joinClassNames("multiboard__cell", ALIGN_CLASSES[columns[index]?.align ?? "left"],
        numericClass(cell)),
      icon: index === iconAt ? icon : null,
      id: columns[index]?.id ?? String(index),
      text: formatCell(cell, context)
    })),
    id: row.id
  };
};

const columnView = (column: MultiboardColumn, context: BoardTextContext): BoardColumnView => ({
  className: joinClassNames("multiboard__heading", ALIGN_CLASSES[column.align]),
  header: context.text(column.header),
  id: column.id,
  style: column.width === "auto" ? undefined : { width: column.width }
});

/** A board prepared for the view; `rows` come from the caller's row cache. */
export const getBoardView = (
  board: MultiboardSnapshot, collapsed: boolean, rows: readonly BoardRowView[], context: BoardTextContext
): BoardView => {
  const title = context.text(board.title);
  const columns = board.columns.map(column => columnView(column, context));
  return {
    bodyId: `multiboard-${board.id}`,
    className: collapsed ? COLLAPSED_BOARD_CLASS : BOARD_CLASS,
    collapsed,
    columns,
    expanded: !collapsed,
    hasHeaders: columns.some(column => column.header.trim() !== ""),
    id: board.id,
    revision: board.collapseRevision,
    rows,
    title,
    toggleIcon: collapsed ? "expand" : "collapse",
    toggleLabel: collapsed ? context.expandLabel(title) : context.collapseLabel(title)
  };
};

/**
 * Prepared boards by snapshot identity. The engine keeps unchanged boards and rows by reference, so an unchanged
 * row or board returns the very same view object and its memoized component does not render again.
 */
export const createBoardViewCache = (context: BoardTextContext) => {
  const rowViews = new WeakMap<MultiboardRowSnapshot, BoardRowView>();
  const rowLists = new WeakMap<readonly MultiboardRowSnapshot[], readonly BoardRowView[]>();
  const boardViews = new WeakMap<MultiboardSnapshot, Partial<Record<"collapsed" | "expanded", BoardView>>>();
  const rowView = (row: MultiboardRowSnapshot, columns: readonly MultiboardColumn[]) => {
    let view = rowViews.get(row);
    if (!view) rowViews.set(row, view = getRowView(row, columns, context));
    return view;
  };
  const rowList = (board: MultiboardSnapshot) => {
    let rows = rowLists.get(board.rows);
    if (!rows) rowLists.set(board.rows, rows = board.rows.map(row => rowView(row, board.columns)));
    return rows;
  };
  return (board: MultiboardSnapshot, collapsed: boolean): BoardView => {
    const state = collapsed ? "collapsed" : "expanded";
    let views = boardViews.get(board);
    if (!views) boardViews.set(board, views = {});
    return views[state] ??= getBoardView(board, collapsed, rowList(board), context);
  };
};

export type BoardViewCache = ReturnType<typeof createBoardViewCache>;

interface StackLayout {
  /** The board the player expanded last (phone layout). */
  focusedId: string | null;
  phone: boolean;
  scope: string;
  toggles: LocalCollapseMap;
}

/** Every visible board in feed order with its effective collapse state (player toggle, then the phone rule). */
export const getBoardViews = (
  boards: readonly MultiboardSnapshot[], layout: StackLayout, viewOf: BoardViewCache
): readonly BoardView[] => {
  const collapsed = boards.map(board =>
    isBoardCollapsed(board, layout.toggles[collapseKey(layout.scope, board.id)]));
  if (!layout.phone) return boards.map((board, index) => viewOf(board, collapsed[index]!));
  const expandedIds = boards.filter((_board, index) => !collapsed[index]).map(board => board.id);
  const expandedId = phoneExpandedBoard(expandedIds, layout.focusedId);
  return boards.map(board => viewOf(board, board.id !== expandedId));
};
