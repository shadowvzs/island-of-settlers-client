import { DMath } from "../math/deterministic-math";
import { BRIDGE_FLARE_LENGTH, bridgeApproaches } from "./bridge-approaches";
import { BRIDGE_DECK_HALF_WIDTH, BRIDGE_STRUCTURE_HALF_WIDTH, type BridgeDeck, deckPoint } from "./bridge-deck";
import {
  ROAD_GRID_STEP,
  ROAD_PLACEMENT_HALF_WIDTH,
  ROAD_STONE_WIDTH,
  type RoadPoint,
  type RoadSegment
} from "./road-types";

/** Axis-aligned ground rectangle in world cells. */
export interface StripRect {
  bottom: number;
  left: number;
  right: number;
  top: number;
}
/** Every public road reserves the paved upgrade and both logical verges, independent of decoration. */
export type StripSegment = Pick<RoadSegment, "end" | "start"> & Partial<Pick<RoadSegment, "bridge">>;
interface StripRoads {
  revision?: number;
  segments?: () => readonly StripSegment[];
}

const EPSILON = 1e-6;
/** Numeric bucket key; unique for the cell coordinates any island uses (|x| < 32768). */
const bucketKey = (x: number, z: number) => z * 65536 + x;

const pointRectDistance = (point: RoadPoint, rect: StripRect) =>
  DMath.hypot(Math.max(0, rect.left - point.x, point.x - rect.right),
    Math.max(0, rect.top - point.z, point.z - rect.bottom));

const pointSegmentDistance = (point: RoadPoint, segment: StripSegment) => {
  const dx = segment.end.x - segment.start.x, dz = segment.end.z - segment.start.z;
  const fraction = Math.max(0, Math.min(1,
    ((point.x - segment.start.x) * dx + (point.z - segment.start.z) * dz) / (dx * dx + dz * dz)));
  return DMath.hypot(point.x - segment.start.x - dx * fraction, point.z - segment.start.z - dz * fraction);
};

/** Liang-Barsky clip of a centreline against the rectangle. */
const segmentCrossesRect = (segment: StripSegment, rect: StripRect) => {
  const dx = segment.end.x - segment.start.x, dz = segment.end.z - segment.start.z;
  let enter = 0, leave = 1;
  for (const [origin, delta, minimum, maximum] of [
    [segment.start.x, dx, rect.left, rect.right], [segment.start.z, dz, rect.top, rect.bottom]
  ] as const) {
    if (Math.abs(delta) < 1e-12) {
      if (origin < minimum || origin > maximum) return false;
      continue;
    }
    const first = (minimum - origin) / delta, second = (maximum - origin) / delta;
    enter = Math.max(enter, Math.min(first, second));
    leave = Math.min(leave, Math.max(first, second));
  }
  return enter <= leave;
};

/** Shortest ground distance between a road centreline and a rectangle (0 when they touch). */
export const segmentRectDistance = (segment: StripSegment, rect: StripRect) => {
  const minX = Math.min(segment.start.x, segment.end.x), maxX = Math.max(segment.start.x, segment.end.x);
  const minZ = Math.min(segment.start.z, segment.end.z), maxZ = Math.max(segment.start.z, segment.end.z);
  // Axis-aligned road edges: the gap between two boxes is exact.
  if (minX === maxX || minZ === maxZ) return DMath.hypot(Math.max(0, minX - rect.right, rect.left - maxX),
    Math.max(0, minZ - rect.bottom, rect.top - maxZ));
  // Angled bridge decks: exact segment-to-box distance.
  if (segmentCrossesRect(segment, rect)) return 0;
  const corners = [
    { x: rect.left, z: rect.top }, { x: rect.right, z: rect.top },
    { x: rect.left, z: rect.bottom }, { x: rect.right, z: rect.bottom }
  ];
  return Math.min(pointRectDistance(segment.start, rect), pointRectDistance(segment.end, rect),
    ...corners.map(corner => pointSegmentDistance(corner, segment)));
};

/** True when a rectangle reaches into a road's reserved stone strip. */
export const stripOverlapsRect = (segment: StripSegment, rect: StripRect, halfWidth: number) =>
  segmentRectDistance(segment, rect) < halfWidth - EPSILON;

/** Empty verges reserve plots without widening the graded road or clearing natural terrain props. */
export const isRoadVergeClear = (start: RoadPoint, end: RoadPoint,
  isBlocked: ((x: number, z: number) => boolean) | undefined, validPoint: (point: RoadPoint) => boolean) => {
  if (!isBlocked) return true;
  const dx = end.x - start.x, dz = end.z - start.z, length = DMath.hypot(dx, dz);
  if (length < EPSILON) return false;
  for (const fraction of [0, .5, 1]) for (const side of [-1, 1]) {
    const x = start.x + dx * fraction - dz / length * ROAD_PLACEMENT_HALF_WIDTH * side;
    const z = start.z + dz * fraction + dx / length * ROAD_PLACEMENT_HALF_WIDTH * side;
    if (validPoint({ x, z }) && isBlocked(x, z)) return false;
  }
  return true;
};

/**
 * A new half-cell step whose strip would overlap a parallel existing road beside it (closer than the
 * full reserved width). Crossing and joining roads stay allowed: they share nodes, not a parallel span.
 */
export const parallelRoadConflict = (
  start: RoadPoint, end: RoadPoint, hasEdge: (a: RoadPoint, b: RoadPoint) => boolean
) => {
  const dx = end.x - start.x, dz = end.z - start.z, length = DMath.hypot(dx, dz);
  if (length < EPSILON) return false;
  const normalX = -dz / length, normalZ = dx / length;
  for (let offset = ROAD_GRID_STEP; offset < ROAD_STONE_WIDTH - EPSILON; offset += ROAD_GRID_STEP)
    for (const side of [-1, 1]) {
      const shiftX = normalX * offset * side, shiftZ = normalZ * offset * side;
      if (hasEdge({ x: start.x + shiftX, z: start.z + shiftZ }, { x: end.x + shiftX, z: end.z + shiftZ }))
        return true;
    }
  return false;
};

/** A reserved centreline with its own minimum half width (bridge decks and their flared approaches). */
interface StripEntry {
  halfWidth: number;
  segment: StripSegment;
}

/** Bridge decks reserve their railings and abutments, plus a short landing behind each anchor. */
const BRIDGE_LANDING = 0.5;

const deckStrip = (deck: BridgeDeck): StripEntry => ({
  halfWidth: BRIDGE_STRUCTURE_HALF_WIDTH,
  segment: { end: deckPoint(deck, deck.length + BRIDGE_LANDING, 0), start: deckPoint(deck, -BRIDGE_LANDING, 0) }
});

/** Bridge structures and the flared shore roads that meet them (any angle to the grid). */
const bridgeStrips = (segments: readonly RoadSegment[]): StripEntry[] => bridgeApproaches(segments)
  .flatMap((approach, index) => [
    ...(index % 2 === 0 ? [deckStrip(approach.deck)] : []),
    ...approach.pieces.filter(piece => piece.startDistance < BRIDGE_FLARE_LENGTH)
      .map(piece => ({ halfWidth: BRIDGE_DECK_HALF_WIDTH, segment: piece.segment }))
  ]);

/** Every cell an entry's widened bounds touch, so long angled decks are found from either end. */
const stripCells = (entry: StripEntry) => {
  const { end, start } = entry.segment, reach = entry.halfWidth;
  const keys: number[] = [];
  for (let z = Math.floor(Math.min(start.z, end.z) - reach); z <= Math.floor(Math.max(start.z, end.z) + reach); z++)
    for (let x = Math.floor(Math.min(start.x, end.x) - reach); x <= Math.floor(Math.max(start.x, end.x) + reach); x++)
      keys.push(bucketKey(x, z));
  return keys;
};

/**
 * Road centrelines bucketed per cell and rebuilt only when the road revision changes, so placement,
 * planting and field checks query a few nearby edges instead of the whole network.
 */
export const createRoadStripIndex = (roads: StripRoads) => {
  let revision: number | undefined = undefined;
  let buckets = new Map<number, StripEntry[]>();
  const add = (key: number, entry: StripEntry) => {
    const list = buckets.get(key);
    if (list) list.push(entry);
    else buckets.set(key, [entry]);
  };
  const refresh = () => {
    if (revision !== undefined && revision === roads.revision) return;
    revision = roads.revision ?? 0;
    buckets = new Map();
    const segments = roads.segments?.() ?? [];
    for (const segment of segments) {
      if (segment.bridge) continue;
      add(bucketKey(Math.floor((segment.start.x + segment.end.x) / 2),
        Math.floor((segment.start.z + segment.end.z) / 2)), { halfWidth: 0, segment });
    }
    for (const entry of bridgeStrips(segments as readonly RoadSegment[]))
      for (const key of stripCells(entry)) add(key, entry);
  };
  /** First road whose reserved strip reaches the rectangle (skipping `ignore`), or null. */
  const findInRect = (rect: StripRect, ignore?: (segment: StripSegment) => boolean,
    halfWidth = ROAD_PLACEMENT_HALF_WIDTH) => {
    refresh();
    // Half-cell edges sit in their midpoint cell: one cell of margin covers their full span.
    const reach = ROAD_PLACEMENT_HALF_WIDTH + 1;
    for (let z = Math.floor(rect.top - reach); z <= Math.floor(rect.bottom + reach); z++)
      for (let x = Math.floor(rect.left - reach); x <= Math.floor(rect.right + reach); x++)
        for (const entry of buckets.get(bucketKey(x, z)) ?? [])
          if (stripOverlapsRect(entry.segment, rect, Math.max(halfWidth, entry.halfWidth)) &&
            !ignore?.(entry.segment)) return entry.segment;
    return null;
  };
  /** True when the cell at (x, z) lies outside every road's reserved strip. */
  const isCellClear = (x: number, z: number) =>
    !findInRect({ bottom: z + 1, left: x, right: x + 1, top: z });
  return { findInRect, isCellClear };
};

type RoadStripIndex = ReturnType<typeof createRoadStripIndex>;

const indexes = new WeakMap<StripRoads, RoadStripIndex>();
/** One shared index per road network. */
export const roadStripIndex = (roads: StripRoads) => {
  let index = indexes.get(roads);
  if (!index) { index = createRoadStripIndex(roads); indexes.set(roads, index); }
  return index;
};
