import { DMath } from "../math/deterministic-math";
import { BRIDGE_MAX_TILES, ROAD_GRID_STEP, type RoadPoint } from "./road-types";

/**
 * Angled bridges keep both shore anchors on the half-cell road grid. A straight span between two
 * grid nodes is split at every grid node it passes through, so each graph edge is one primitive
 * lattice step `(stepX, stepZ)` in half cells: the axis-aligned span keeps its half-cell edges and a
 * diagonal span gets longer edges that never hide a grid node inside them. All arithmetic is integer.
 */
export interface BridgeLatticeSpan {
  /** Graph edges in the span: the greatest common divisor of both half-cell deltas. */
  edges: number;
  /** Primitive half-cell step of one edge. */
  stepX: number;
  stepZ: number;
  /** Span length in half-cell tiles measured along the deck, rounded up (the paid tile count). */
  tiles: number;
}

const toHalfCells = (value: number) => Math.round(value / ROAD_GRID_STEP);

const isOnHalfCells = (value: number) => Number.isFinite(value) &&
  Math.abs(value / ROAD_GRID_STEP - toHalfCells(value)) < 1e-8;

export const greatestCommonDivisor = (first: number, second: number) => {
  let a = Math.abs(first), b = Math.abs(second);
  while (b) [a, b] = [b, a % b];
  return a;
};

/** Smallest whole tile count covering a span of `sqrt(squared)` half cells. */
const ceilSquareRoot = (squared: number) => {
  let root = Math.floor(Math.sqrt(squared));
  while (root * root < squared) root += 1;
  while (root > 0 && (root - 1) * (root - 1) >= squared) root -= 1;
  return root;
};

/** Paid bridge tiles of a half-cell delta: the deck length along the span, rounded up to whole tiles. */
export const bridgeSpanTiles = (deltaX: number, deltaZ: number) =>
  ceilSquareRoot(deltaX * deltaX + deltaZ * deltaZ);

/** Lattice decomposition of the straight span between two grid nodes, or null when degenerate. */
export const bridgeLatticeSpan = (start: RoadPoint, end: RoadPoint): BridgeLatticeSpan | null => {
  if (![start.x, start.z, end.x, end.z].every(isOnHalfCells)) return null;
  const deltaX = toHalfCells(end.x) - toHalfCells(start.x);
  const deltaZ = toHalfCells(end.z) - toHalfCells(start.z);
  const edges = greatestCommonDivisor(deltaX, deltaZ);
  if (!edges) return null;
  return { edges, stepX: deltaX / edges, stepZ: deltaZ / edges, tiles: bridgeSpanTiles(deltaX, deltaZ) };
};

/** One bridge graph edge: a primitive half-cell step no longer than the longest permitted span. */
export const isBridgeLatticeEdge = (start: RoadPoint, end: RoadPoint) => {
  const span = bridgeLatticeSpan(start, end);
  return span !== null && span.edges === 1 && span.tiles <= BRIDGE_MAX_TILES;
};

/** World length of one graph edge; ordinary half-cell edges keep their exact grid step. */
export const roadEdgeLength = (start: RoadPoint, end: RoadPoint) => {
  const dx = end.x - start.x, dz = end.z - start.z;
  if (dx === 0 || dz === 0) return Math.abs(dx + dz);
  return DMath.hypot(dx, dz);
};

/** Grid nodes of the span from `start`, one per graph edge boundary (`edges + 1` points). */
export const bridgeLatticeNodes = (start: RoadPoint, span: BridgeLatticeSpan): RoadPoint[] =>
  Array.from({ length: span.edges + 1 }, (_, index) => ({
    x: (toHalfCells(start.x) + span.stepX * index) * ROAD_GRID_STEP,
    z: (toHalfCells(start.z) + span.stepZ * index) * ROAD_GRID_STEP
  }));
