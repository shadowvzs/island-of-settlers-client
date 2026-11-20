/**
 * Tunic colours of the player's workers (Settings > Workers), chosen to stand out on every ground
 * of the island: yellow-green meadows, brown dirt and forest floor, pale gravel and sand, snow.
 * Blue is the default (owner's choice).
 */
export const WORKER_COLORS = [
  { hex: "#2f5bc4", id: "blue", label: "Blue" },
  { hex: "#c62828", id: "red", label: "Red" },
  /** Bright golden, not lemon: reads against the yellow-green grass by brightness. */
  { hex: "#f5c400", id: "yellow", label: "Yellow" },
  /** Reddish chestnut, darker than the dirt. */
  { hex: "#7b3b1d", id: "brown", label: "Brown" },
  /** Emerald, away from the yellow-green grass. */
  { hex: "#0f8a5f", id: "green", label: "Green" },
  { hex: "#1d1d22", id: "black", label: "Black" },
  { hex: "#f2f2ee", id: "white", label: "White" }
] as const;

export type WorkerColor = (typeof WORKER_COLORS)[number]["id"];

export const DEFAULT_WORKER_COLOR: WorkerColor = "blue";

export const isWorkerColor = (value: unknown): value is WorkerColor =>
  WORKER_COLORS.some((color) => color.id === value);

/** The tunic colour (hex) of a palette entry. */
export const getWorkerColorHex = (color: WorkerColor) =>
  WORKER_COLORS.find((entry) => entry.id === color)!.hex;
