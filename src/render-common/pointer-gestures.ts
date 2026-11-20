/** A press that moves farther than this (CSS pixels) is a drag, not a tap. */
export const TAP_MAX_MOVE_PIXELS = 6;
/** A press held longer than this is no tap (a slow press or a long press). */
export const TAP_MAX_MS = 400;
/** A still touch press held this long is a long press (the touch right click). */
export const LONG_PRESS_MS = 550;

/** A pointer position (client CSS pixels). */
export interface PointerPoint {
  x: number;
  y: number;
}

/** Two touch points: their distance and midpoint (client CSS pixels). */
export interface PinchFrame {
  distance: number;
  midX: number;
  midY: number;
}

/** What a finished press was: what the input layers act on. */
export type PressKind = "drag" | "long-press" | "pinch" | "slow" | "tap";

export interface PressSummary {
  durationMs: number;
  /** The most pointers down at once during the press. */
  maxPointers: number;
  movedPixels: number;
}

export const measurePinch = (a: PointerPoint, b: PointerPoint): PinchFrame => ({
  distance: Math.hypot(b.x - a.x, b.y - a.y),
  midX: (a.x + b.x) / 2,
  midY: (a.y + b.y) / 2
});

/** Zoom factor of a pinch step: fingers twice as far apart zoom in twice (1 for no distance). */
export const getPinchZoomFactor = (from: PinchFrame, to: PinchFrame) => {
  if (from.distance <= 0 || to.distance <= 0) return 1;
  return to.distance / from.distance;
};

/** Classifies a press: a second pointer makes it a pinch, then movement, then its duration. */
export const classifyPress = ({
  durationMs,
  maxPointers,
  movedPixels
}: PressSummary): PressKind => {
  if (maxPointers > 1) return "pinch";
  if (movedPixels > TAP_MAX_MOVE_PIXELS) return "drag";
  if (durationMs >= LONG_PRESS_MS) return "long-press";
  if (durationMs > TAP_MAX_MS) return "slow";
  return "tap";
};
