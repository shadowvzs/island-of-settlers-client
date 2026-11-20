import { DMath } from "../math/deterministic-math";
import type { RoadLengthField } from "./road-length-field";
import { ROAD_GRID_STEP, ROAD_STONE_WIDTH } from "./road-types";
import { groundPath } from "./settlement-paths";
import type { SettlementContext, SettlementPoint } from "./settlement-types";

/** A cart on a rounded bend runs at most this far past an upgraded edge's end node. */
const STONE_TOLERANCE = .2;
/** Sideways, a cart keeping right is anywhere on the 1.2 stone ribbon. */
const STONE_HALF_WIDTH = ROAD_STONE_WIDTH / 2;
const SAMPLE_STEP = .1;
const ROAD_ENTRY_RANGE = .85;

const edgeKey = (ax: number, az: number, bx: number, bz: number) => `${ax}:${az}/${bx}:${bz}`;
const stoneIndexes = new WeakMap<SettlementContext, { revision: number; keys: Set<string> }>();

/** Stone edges by grid key, rebuilt once per road revision. */
const stoneEdgeKeys = (context: SettlementContext) => {
  const roads = context.options.roads;
  const revision = roads.revision ?? -1;
  const cached = stoneIndexes.get(context);
  if (cached?.revision === revision) return cached.keys;
  const keys = new Set<string>();
  for (const segment of roads.segments?.() ?? []) {
    if (segment.tier === "dirt") continue;
    const [first, second] = segment.start.x + segment.start.z <= segment.end.x + segment.end.z
      ? [segment.start, segment.end] : [segment.end, segment.start];
    keys.add(edgeKey(first.x, first.z, second.x, second.z));
  }
  stoneIndexes.set(context, { keys, revision });
  return keys;
};

/** On the edge's ribbon, or on a bend just past its end; never along a dirt edge continuing it. */
const nearSegment = (point: SettlementPoint, ax: number, az: number, bx: number, bz: number) => {
  const dx = bx - ax, dz = bz - az, length = DMath.hypot(dx, dz);
  const along = ((point.x - ax) * dx + (point.z - az) * dz) / length;
  const sideways = Math.abs((point.z - az) * dx - (point.x - ax) * dz) / length;
  const past = Math.max(0, -along, along - length);
  return sideways <= STONE_HALF_WIDTH && past <= STONE_TOLERANCE;
};

/** True when the point lies on (or within a bend's reach of) a committed stone edge. */
export const isOnStoneRoad = (context: SettlementContext, point: SettlementPoint) => {
  const keys = stoneEdgeKeys(context);
  if (!keys.size) return false;
  const baseX = Math.floor(point.x / ROAD_GRID_STEP) * ROAD_GRID_STEP - ROAD_GRID_STEP;
  const baseZ = Math.floor(point.z / ROAD_GRID_STEP) * ROAD_GRID_STEP - ROAD_GRID_STEP;
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      const x = baseX + column * ROAD_GRID_STEP, z = baseZ + row * ROAD_GRID_STEP;
      const right = x + ROAD_GRID_STEP, down = z + ROAD_GRID_STEP;
      if (keys.has(edgeKey(x, z, right, z)) && nearSegment(point, x, z, right, z)) return true;
      if (keys.has(edgeKey(x, z, x, down)) && nearSegment(point, x, z, x, down)) return true;
    }
  }
  return false;
};

/** Every sampled point of the polyline must remain on stone; a single gap fails the route. */
export const isStonePath = (context: SettlementContext, points: readonly SettlementPoint[]) => {
  if (!points.length) return false;
  if (!isOnStoneRoad(context, points[0]!)) return false;
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1]!, end = points[index]!;
    const steps = Math.ceil(DMath.hypot(end.x - start.x, end.z - start.z) / SAMPLE_STEP);
    for (let step = 1; step <= steps; step++) {
      const fraction = step / steps;
      const sample = { x: start.x + (end.x - start.x) * fraction, z: start.z + (end.z - start.z) * fraction };
      if (!isOnStoneRoad(context, sample)) return false;
    }
  }
  return true;
};

const nearbyNodes = (point: SettlementPoint) => {
  const x = Math.round(point.x / ROAD_GRID_STEP) * ROAD_GRID_STEP;
  const z = Math.round(point.z / ROAD_GRID_STEP) * ROAD_GRID_STEP;
  const nodes: SettlementPoint[] = [];
  for (const dx of [0, -ROAD_GRID_STEP, ROAD_GRID_STEP])
    for (const dz of [0, -ROAD_GRID_STEP, ROAD_GRID_STEP]) nodes.push({ x: x + dx, z: z + dz });
  return nodes.sort((a, b) => DMath.hypot(a.x - point.x, a.z - point.z) - DMath.hypot(b.x - point.x, b.z - point.z));
};

/**
 * Replans entirely over stone from where the cart stands: only a node reached over stone
 * (the cart never crosses dirt or a gap to rejoin) can start the new route.
 */
export const stoneRouteFrom = (context: SettlementContext, from: SettlementPoint, to: SettlementPoint) => {
  const stoneRoute = context.options.roads.stoneRoute;
  if (!stoneRoute) return null;
  let best: { cost: number; points: SettlementPoint[] } | null = null;
  for (const node of nearbyNodes(from)) {
    const reach = DMath.hypot(node.x - from.x, node.z - from.z);
    if (reach > ROAD_ENTRY_RANGE || !isStonePath(context, [from, node])) continue;
    const route = node.x === to.x && node.z === to.z
      ? { cost: 0, points: [node] } : stoneRoute(node, to);
    if (!route) continue;
    const cost = route.cost + reach;
    if (!best || cost < best.cost) best = { cost, points: route.points };
  }
  return best;
};

interface EntryNodes { nodes: readonly SettlementPoint[]; x: number; z: number }
const entryNodeMemo = new WeakMap<SettlementPoint, EntryNodes>();

/** The nodes `footRouteFrom` may start from, in its order; a pure function of the position, kept per point. */
const entryNodes = (from: SettlementPoint) => {
  const known = entryNodeMemo.get(from);
  if (known?.x === from.x && known.z === from.z) return known.nodes;
  const nodes = nearbyNodes(from).filter(node => !(DMath.hypot(node.x - from.x, node.z - from.z) > ROAD_ENTRY_RANGE));
  entryNodeMemo.set(from, { nodes, x: from.x, z: from.z });
  return nodes;
};

/**
 * A04d: the node `footRouteFrom(context, from, to, false)` starts its route from and the field's
 * walked length from there, without searching; null exactly when that call returns null.
 */
export const footRouteEntry = (from: SettlementPoint, field: RoadLengthField) => {
  for (const node of entryNodes(from)) {
    const length = field(node);
    if (Number.isFinite(length)) return { length, node };
  }
  return null;
};

/**
 * Any-tier road route from wherever the unit stands. A carrier on foot may fall back to plain
 * ground; a pulled cart (`allowGround` false) never leaves the roads.
 */
export const footRouteFrom = (
  context: SettlementContext,
  from: SettlementPoint,
  to: SettlementPoint,
  allowGround = true
): SettlementPoint[] | null => {
  const roads = context.options.roads;
  for (const node of nearbyNodes(from)) {
    if (DMath.hypot(node.x - from.x, node.z - from.z) > ROAD_ENTRY_RANGE) continue;
    const route = roads.route(node, to);
    if (route) return route.points;
  }
  return allowGround ? groundPath(context, from, to) : null;
};
