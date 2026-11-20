/** Constants of the multiboard editor (design §13.5, lane TRG12). */

export const COLUMN_ALIGNS = ["left", "right", "center"] as const;

/** Row sources of a board, in the order the editor offers them. */
export const ROW_SOURCES = ["static", "players", "array"] as const;
export type RowSourceKind = (typeof ROW_SOURCES)[number];

/** Rows a new "one row per list item" source shows at most. */
export const DEFAULT_ARRAY_ROWS = 8;

/** Width of a new numeric column (pixels); text columns start at "auto". */
export const NUMBER_COLUMN_WIDTH = 64;

/** Id prefixes of new columns and static rows (`c1`, `r1` …, unique inside the board). */
export const COLUMN_ID_PREFIX = "c";
export const ROW_ID_PREFIX = "r";

/** The base variable name of a new board. */
export const NEW_BOARD_NAME = "board";

/** The player who sees a new board (Player 1, the human). */
export const BOARD_VIEWER_FACTION = 0;

/** Player-visible texts a new board, column or row starts with (all game languages; the author edits them). */
export const NEW_BOARD_TEXTS = {
  column: { de: "Wert", en: "Value", hu: "Érték" },
  row: { de: "Aufgabe", en: "Task", hu: "Feladat" },
  rowHeader: { de: "Aufgabe", en: "Task", hu: "Feladat" },
  title: { de: "Neue Tafel", en: "New board", hu: "Új tábla" },
  valueHeader: { de: "Erledigt", en: "Done", hu: "Kész" }
} as const;
