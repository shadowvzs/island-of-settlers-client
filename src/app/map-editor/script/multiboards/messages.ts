import { msg } from "@lingui/core/macro";

/** Copy of the Multiboards tab (design §13.5); en source, hu and de in the PO catalogs. */
export const BOARD_MESSAGES = {
  tab: msg({ id: "mapEditor.script.tab.boards", message: "Multiboards" }),
  info: msg({
    id: "mapEditor.script.boards.info",
    message: "A board is a small table on the player's screen. Cells show variables or world values; actions show, hide or collapse it."
  }),
  add: msg({ id: "mapEditor.script.boards.add", message: "+ Board" }),
  list: msg({ id: "mapEditor.script.boards.list", message: "Boards" }),
  empty: msg({ id: "mapEditor.script.boards.empty", message: "No board yet." }),
  none: msg({ id: "mapEditor.script.boards.none", message: "Choose a board or add one." }),
  variable: msg({ id: "mapEditor.script.boards.variable", message: "Variable name" }),
  title: msg({ id: "mapEditor.script.boards.title", message: "Title" }),
  visible: msg({ id: "mapEditor.script.boards.visible", message: "Visible at start" }),
  collapsed: msg({ id: "mapEditor.script.boards.collapsed", message: "Collapsed at start" }),
  audience: msg({ id: "mapEditor.script.boards.audience", message: "Shown to" }),
  rows: msg({ id: "mapEditor.script.boards.rows", message: "Rows" }),
  rowSource: {
    static: msg({ id: "mapEditor.script.boards.rows.static", message: "fixed rows" }),
    players: msg({ id: "mapEditor.script.boards.rows.players", message: "one per player" }),
    array: msg({ id: "mapEditor.script.boards.rows.array", message: "one per list item" })
  },
  rowList: msg({ id: "mapEditor.script.boards.rowList", message: "List" }),
  maxRows: msg({ id: "mapEditor.script.boards.maxRows", message: "At most" }),
  players: msg({ id: "mapEditor.script.boards.players", message: "Players" }),
  sort: msg({ id: "mapEditor.script.boards.sort", message: "Sort by" }),
  unsorted: msg({ id: "mapEditor.script.boards.unsorted", message: "not sorted" }),
  descending: msg({ id: "mapEditor.script.boards.descending", message: "largest first" }),
  ascending: msg({ id: "mapEditor.script.boards.ascending", message: "smallest first" }),
  columns: msg({ id: "mapEditor.script.boards.columns", message: "Columns" }),
  addColumn: msg({ id: "mapEditor.script.boards.addColumn", message: "+ Column" }),
  header: msg({ id: "mapEditor.script.boards.header", message: "Header" }),
  format: msg({ id: "mapEditor.script.boards.format", message: "Shows" }),
  width: msg({ id: "mapEditor.script.boards.width", message: "Width (px, empty = auto)" }),
  widthShort: msg({ id: "mapEditor.script.boards.widthShort", message: "Width" }),
  widthAuto: msg({ id: "mapEditor.script.boards.widthAuto", message: "auto" }),
  align: msg({ id: "mapEditor.script.boards.align", message: "Align" }),
  aligns: {
    left: msg({ id: "mapEditor.script.boards.align.left", message: "left" }),
    right: msg({ id: "mapEditor.script.boards.align.right", message: "right" }),
    center: msg({ id: "mapEditor.script.boards.align.center", message: "centre" })
  },
  formats: {
    text: msg({ id: "mapEditor.script.boards.format.text", message: "text" }),
    number: msg({ id: "mapEditor.script.boards.format.number", message: "number" }),
    fraction: msg({ id: "mapEditor.script.boards.format.fraction", message: "progress (3 / 8)" }),
    percent: msg({ id: "mapEditor.script.boards.format.percent", message: "percent" }),
    countdown: msg({ id: "mapEditor.script.boards.format.countdown", message: "countdown (m:ss)" }),
    iconNumber: msg({ id: "mapEditor.script.boards.format.iconNumber", message: "icon and number" })
  },
  moveLeft: msg({ id: "mapEditor.script.boards.moveLeft", message: "Move column {name} left" }),
  moveRight: msg({ id: "mapEditor.script.boards.moveRight", message: "Move column {name} right" }),
  removeColumn: msg({ id: "mapEditor.script.boards.removeColumn", message: "Remove column {name}" }),
  addRow: msg({ id: "mapEditor.script.boards.addRow", message: "+ Row" }),
  rowLabel: msg({ id: "mapEditor.script.boards.rowLabel", message: "Row label" }),
  rowIcon: msg({ id: "mapEditor.script.boards.rowIcon", message: "Icon" }),
  removeRow: msg({ id: "mapEditor.script.boards.removeRow", message: "Remove row {number}" }),
  moveRowUp: msg({ id: "mapEditor.script.boards.moveRowUp", message: "Move row {number} up" }),
  preview: msg({ id: "mapEditor.script.boards.preview", message: "Preview (values at map start)" }),
  previewUnavailable: msg({
    id: "mapEditor.script.boards.previewUnavailable",
    message: "The preview appears once every cell is set."
  }),
  delete: msg({ id: "mapEditor.script.boards.delete", message: "Delete board" }),
  usedBy: msg({ id: "mapEditor.script.boards.usedBy", message: "Used by: {users}" }),
  unused: msg({ id: "mapEditor.script.boards.unused", message: "Not shown by any action yet" })
};
