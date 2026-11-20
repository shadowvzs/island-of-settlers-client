import { ROAD_STONE_WIDTH, ROAD_TIER_WIDTH, ROAD_WIDTH, type RoadPoint, type RoadSegment } from "./road-types";

/** What an upgraded road must not cover when it widens in place. */
export interface RoadWidthObstacles {
  /** Plots, crops and blocking props: the cells road construction already refuses. */
  isBlocked: (x: number, z: number) => boolean;
  /** Distance from a centreline to the nearest small obstacle (signpost stakes); Infinity when none. */
  clearance?: (start: RoadPoint, end: RoadPoint) => number;
}

/** Fitted half widths tried down to the current dirt width. */
const HALF_WIDTH_STEP = 0.05;
const SAMPLE_FRACTIONS = [0, .25, .5, .75, 1];
/** Lateral samples sit just inside the tried edge, so a road ending on a cell border is not blocked by it. */
const EDGE_INSET = 0.01;
const pointKey = (point: RoadPoint) => `${point.x}:${point.z}`;

const isHalfWidthFree = (segment: RoadSegment, half: number, obstacles: RoadWidthObstacles) => {
  const dx = segment.end.x - segment.start.x, dz = segment.end.z - segment.start.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-7) return true;
  const normalX = -dz / length * (half - EDGE_INSET), normalZ = dx / length * (half - EDGE_INSET);
  for (const fraction of SAMPLE_FRACTIONS) {
    const x = segment.start.x + dx * fraction, z = segment.start.z + dz * fraction;
    if (obstacles.isBlocked(x + normalX, z + normalZ) || obstacles.isBlocked(x - normalX, z - normalZ))
      return false;
  }
  return true;
};

/** Widest free public ribbon beside plots, crops and signposts. */
export const fittedStoneWidth = (segment: RoadSegment, obstacles: RoadWidthObstacles) => {
  const stakeLimit = obstacles.clearance?.(segment.start, segment.end) ?? Infinity;
  for (let half = ROAD_TIER_WIDTH[segment.tier] / 2; half > ROAD_WIDTH / 2 + 1e-6; half -= HALF_WIDTH_STEP)
    if (half <= stakeLimit && isHalfWidthFree(segment, half, obstacles)) return half * 2;
  return ROAD_WIDTH;
};

const isPublicStreet = (segment: RoadSegment) => !segment.bridge && !segment.doorway &&
  segment.startWidth === undefined && segment.endWidth === undefined;

/** The narrowest fitted width of public streets meeting at each node. */
const fittedNodeWidths = (segments: readonly RoadSegment[], obstacles: RoadWidthObstacles) => {
  const nodes = new Map<string, number>();
  for (const segment of segments) {
    if (!isPublicStreet(segment)) continue;
    const width = fittedStoneWidth(segment, obstacles);
    // A clear dirt branch does not squeeze the paved intersection down to its own tier width.
    const limit = width < ROAD_TIER_WIDTH[segment.tier] - 1e-6 ? width : ROAD_STONE_WIDTH;
    for (const point of [segment.start, segment.end])
      nodes.set(pointKey(point), Math.min(nodes.get(pointKey(point)) ?? ROAD_STONE_WIDTH, limit));
  }
  return nodes;
};

const narrowed = (width: number | undefined, fullWidth: number) => (width !== undefined && width < fullWidth - 1e-6
  ? width : undefined);

/**
 * Where a building, crop or prop reaches into the full paved width, the ribbon narrows
 * down to the current dirt width and tapers back over the neighbouring half cell.
 * Entrance flares starting at such a node start at the same narrowed width.
 */
export const fitStoneRoadWidths = (segments: readonly RoadSegment[], obstacles: RoadWidthObstacles) => {
  const nodes = fittedNodeWidths(segments, obstacles);
  if (![...nodes.values()].some(width => width < ROAD_STONE_WIDTH - 1e-6)) return segments.slice();
  return segments.map(segment => {
    const start = nodes.get(pointKey(segment.start)), end = nodes.get(pointKey(segment.end));
    if (isPublicStreet(segment)) {
      const fullWidth = ROAD_TIER_WIDTH[segment.tier];
      const startWidth = narrowed(start, fullWidth), endWidth = narrowed(end, fullWidth);
      return startWidth === undefined && endWidth === undefined ? segment
        : { ...segment, endWidth: endWidth ?? fullWidth, startWidth: startWidth ?? fullWidth };
    }
    if (segment.startWidth === undefined || start === undefined || start >= segment.startWidth) return segment;
    return { ...segment, startWidth: start };
  });
};
