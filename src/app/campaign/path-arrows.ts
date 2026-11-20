/**
 * Arrow geometry of a campaign path drawing (BR3 editor map view, BR4 player path graph): SVG segments between node
 * centres that stop at the node rims, and polygon heads (no SVG markers: Chrome orients markers wrongly together
 * with `vector-effect: non-scaling-stroke`). Units are the caller's overlay units.
 */
export interface PathPoint {
  x: number;
  y: number;
}

/** One overlay segment. */
export interface PathSegment {
  id: string;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

/** A segment whose shaft ends at the base of `head` (SVG polygon points), the tip at x2,y2 of the input segment. */
export interface PathArrow extends PathSegment {
  head: string;
}

export interface PathArrowSize {
  halfWidth: number;
  length: number;
}

/**
 * The segment between two node centres, shortened by `gap` at both ends so it stops at the node rims; null when the
 * centres are not farther apart than `minimumLength`.
 */
export const segmentBetween = (
  id: string, from: PathPoint, to: PathPoint, minimumLength: number, gap: number
): PathSegment | null => {
  const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
  if (length <= minimumLength) return null;
  const ux = dx / length, uy = dy / length;
  return { id, x1: from.x + ux * gap, x2: to.x - ux * gap, y1: from.y + uy * gap, y2: to.y - uy * gap };
};

const roundOverlay = (value: number) => value.toFixed(2);

/** The segment as an arrow: the shaft stops at the head's base; the head is a polygon. */
export const withArrowHead = (segment: PathSegment, { halfWidth, length: headLength }: PathArrowSize): PathArrow => {
  const { x1, x2, y1, y2 } = segment;
  const length = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / length, uy = (y2 - y1) / length;
  const baseX = x2 - ux * headLength, baseY = y2 - uy * headLength;
  const sideX = -uy * halfWidth, sideY = ux * halfWidth;
  const points = [[x2, y2], [baseX + sideX, baseY + sideY], [baseX - sideX, baseY - sideY]];
  return {
    ...segment, head: points.map(([x, y]) => `${roundOverlay(x!)},${roundOverlay(y!)}`).join(" "), x2: baseX,
    y2: baseY
  };
};
