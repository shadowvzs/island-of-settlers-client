/** Stroke icons of the campaign path controls (24 px box; colour from the button). */
export const PATH_ICON_SHAPES = {
  add: "M12 5v14M5 12h14",
  delete: "M5 7h14M10 7V4h4v3m-7 0 1 13h8l1-13",
  linear: "M4 12h3m4 0h2m4 0h3M7 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0m6 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0",
  unlock: "M6 11h12v9H6zm3 0V8a3 3 0 0 1 5.8-1"
} as const;

/** React key of the campaign-end choice in a "Leads to" list. */
export const END_TARGET_KEY = "end";
