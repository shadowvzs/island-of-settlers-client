/** Pure helpers of `InfoTooltip` (React-free, shared with its tests). */

export interface TooltipRect {
  bottom: number;
  left: number;
  top: number;
  width: number;
}

export interface TooltipSize {
  height: number;
  width: number;
}

export interface TooltipViewport {
  height: number;
  width: number;
}

/** Gap between the button and the tooltip, and the minimum distance to the screen edge. */
const TOOLTIP_GAP = 6;
const TOOLTIP_MARGIN = 8;

/**
 * Fixed position of the tooltip: centred under the button, flipped above when it would leave the
 * bottom of the screen, and clamped horizontally (and vertically as a last resort) inside the viewport.
 */
export const getTooltipPosition = (anchor: TooltipRect, size: TooltipSize, viewport: TooltipViewport) => {
  const maxLeft = Math.max(TOOLTIP_MARGIN, viewport.width - size.width - TOOLTIP_MARGIN);
  const centred = anchor.left + anchor.width / 2 - size.width / 2;
  const left = Math.min(maxLeft, Math.max(TOOLTIP_MARGIN, centred));
  const below = anchor.bottom + TOOLTIP_GAP;
  const above = anchor.top - TOOLTIP_GAP - size.height;
  const fitsBelow = below + size.height <= viewport.height - TOOLTIP_MARGIN;
  const preferred = fitsBelow || above < TOOLTIP_MARGIN ? below : above;
  const maxTop = Math.max(TOOLTIP_MARGIN, viewport.height - size.height - TOOLTIP_MARGIN);
  return { left: Math.round(left), placement: preferred === below ? "below" : "above",
    top: Math.round(Math.min(maxTop, Math.max(TOOLTIP_MARGIN, preferred))) };
};

/** One tooltip line; `marked` lines (e.g. the next level) are emphasised. */
export interface TooltipLine {
  marked?: boolean;
  text: string;
}

/** Class of a tooltip line. */
export const getTooltipLineClassName = (line: TooltipLine) =>
  line.marked ? "info-tooltip__line info-tooltip__line--marked" : "info-tooltip__line";
