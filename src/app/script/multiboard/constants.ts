/** Phone layout of the board stack: one board expanded at a time (design §6.9). */
export const PHONE_LAYOUT_QUERY = "(max-width: 640px)";

/** Remembered header toggles of the player (browser storage convenience); the oldest are dropped first. */
export const REMEMBERED_TOGGLE_LIMIT = 64;

export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_HOUR = 3600;
export const CLOCK_DIGITS = 2;
export const PERCENT_SCALE = 100;
/** Decimals a board number shows at most (averages, ratios). */
export const NUMBER_FRACTION_DIGITS = 2;

export const BOOLEAN_CELL_TEXT = { false: "✗", true: "✓" } as const;

export const BOARD_CLASS = "multiboard";
export const COLLAPSED_BOARD_CLASS = "multiboard multiboard--collapsed";
export const ALIGN_CLASSES = {
  center: "multiboard__cell--center", left: "multiboard__cell--left", right: "multiboard__cell--right"
} as const;

/** Set on the layer while a neighbouring panel occupies the corner; the stylesheet has the default. */
export const TOP_PROPERTY = "--multiboard-top";
export const BELOW_NEIGHBOUR_GAP_PX = 8;
