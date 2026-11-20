import { MOUNTED_NAVIGATION_RADIUS } from "../../render-common/mounts/horse-dimensions";
import { DMath } from "../math/deterministic-math";
import {
  markedNavigationBlocks,
  navigationChangeRevision,
  type TileRect,
  worldNavigationEpoch,
  worldTileRect
} from "../world/navigation-change-log";
import { BLOCKING, PROP, type WorldData } from "../world/world-data";
import { adventureCampNavigationIndex } from "./adventure-camp-navigation";
import { CAMP_FOOT_CLEARANCE,campEscape, campPointIsClear } from "./adventure-camp-obstacles";
import { isOnCompletedBridgeDeck, isOnMountedDeckLane } from "./bridge-deck-navigation";
import { isOnBridgeMasonry } from "./bridge-masonry";
import { type ExploredTiles, type GroundSearchResult, memoisedGroundSearch, noteExploredPoint }
  from "./ground-search-memo";
import {
  isFootprintProbeSurelyClear, isMountedPointSurelyClear, isMountedSegmentSurelyClear
} from "./mounted-clearance-fast-path";
import { everyFootprintProbe } from "./navigation-footprint-probes";
import { countNavigation, profileNavigationStage } from "./navigation-profile";
import { navigationPropRadius, someObstacleInCells, someObstacleNear } from "./navigation-prop-geometry";
import {
  hasBuildingNavigationNearby, isPublicBuildingPointClear, navigationSearchMemo, withBuildingNavigationSearch
} from "./settlement-building-navigation";
import { isUnbuiltPlotEscape } from "./settlement-construction-escape";
import { segmentFraction } from "./settlement-geometry";
import { noteGroundSearchRead } from "./settlement-input-reads";
import { createPathFrontier } from "./settlement-path-frontier";
import { trafficWork } from "./settlement-traffic-counters";
import type { SettlementContext, SettlementPoint } from "./settlement-types";

export { navigationPropRadius } from "./navigation-prop-geometry";
/** A walkable cell, or a point on a completed bridge deck; other water stays closed. */
const isWalkableGround = (context: SettlementContext, cell: number, point: SettlementPoint) =>
  Boolean(context.options.world.walkCost[cell]) || isOnCompletedBridgeDeck(context, point);
/** Map margin, walkable cell and building foundations only (no props). */
export const isTerrainClear = (context: SettlementContext, point: SettlementPoint, allowFoundation = false,
  allowDryBeach = false) => {
  const { world } = context.options;
  if (point.x < 0.12 || point.z < 0.12 || point.x >= world.cellsX - 0.12 || point.z >= world.cellsZ - 0.12) return false;
  const cell = Math.floor(point.z) * world.cellsX + Math.floor(point.x);
  return (isWalkableGround(context, cell, point) || (allowDryBeach && world.blocking[cell] === BLOCKING.water)) &&
    (allowFoundation || isPublicBuildingPointClear(context, point)) &&
    campPointIsClear(adventureCampNavigationIndex(context), point) &&
    // Parapets and abutment faces beside the deck lane are masonry, never ground to walk on.
    !isOnBridgeMasonry(context, point);
};
export const isNavigationClear = (context: SettlementContext, point: SettlementPoint, allowFoundation = false, allowDryBeach = false, clearanceRadius = 0) => {
  if (context.roadDecorations?.isSupportClear(point, clearanceRadius) === false) return false;
  if (!isTerrainClear(context, point, allowFoundation, allowDryBeach)) return false;
  if (!allowFoundation && clearanceRadius > .2 && !isPublicBuildingPointClear(context, point, clearanceRadius)) return false;
  if (clearanceRadius > CAMP_FOOT_CLEARANCE &&
    !campPointIsClear(adventureCampNavigationIndex(context), point, clearanceRadius)) return false;
  return !isNearNavigationObstacle(context, point, clearanceRadius);
};
/** Memo slot of `isNearNavigationObstacle`: obstacle windows per cell and reach. */
const OBSTACLE_WINDOWS = {};
/** The standing trunks and boulders `someObstacleNear` visits around a cell, in its visit order. */
const obstacleWindow = (world: WorldData, cellX: number, cellZ: number, reach: number) => {
  const window: number[] = [];
  someObstacleNear(world, cellX, cellZ, reach, id => { window.push(id); return false; });
  return window;
};
/**
 * Whether a standing trunk or boulder near the point's cell touches the point's clearance circle.
 * A12: inside a navigation search (props cannot change there) the obstacles around each cell are
 * gathered once, so the many samples of a segment or search stop rescanning the same 5 × 5 cells.
 */
const isNearNavigationObstacle = (context: SettlementContext, point: SettlementPoint, clearanceRadius: number) => {
  const { world } = context.options;
  const cellX = Math.floor(point.x), cellZ = Math.floor(point.z), reach = Math.ceil(1.2 + clearanceRadius);
  const touches = (id: number) => DMath.hypot(point.x - world.props.x[id]!, point.z - world.props.z[id]!) <
    navigationPropRadius(world, id) + clearanceRadius;
  const windows = navigationSearchMemo(context, OBSTACLE_WINDOWS, () => new Map<number, number[]>());
  if (!windows) return someObstacleNear(world, cellX, cellZ, reach, touches);
  const key = (reach * world.cellsZ + cellZ) * world.cellsX + cellX;
  let window = windows.get(key);
  if (!window) {
    window = obstacleWindow(world, cellX, cellZ, reach);
    windows.set(key, window);
  }
  return window.some(touches);
};
/**
 * At least this many trunks within this distance (tiles) of a point make it dense forest (gaps of
 * about a tile or less between the trunks); fewer are lone trunks.
 */
const FOREST_RADIUS = 1.6;
const FOREST_TRUNKS = 3;
/**
 * Room for a marching formation (owner decision 2026-10-15): walls, buildings, cliffs, water, large
 * rocks and dense forest narrow the block; lone trunks (single palms, light forest) do not, the
 * soldiers simply step round them.
 */
export const isFormationGroundClear = (context: SettlementContext, point: SettlementPoint) => {
  if (!isTerrainClear(context, point)) return false;
  const { world } = context.options;
  let trunksNear = 0, onTrunk = false;
  const onRock = someObstacleNear(world, Math.floor(point.x), Math.floor(point.z), Math.ceil(FOREST_RADIUS), id => {
    const distance = DMath.hypot(point.x - world.props.x[id]!, point.z - world.props.z[id]!);
    const touching = distance < navigationPropRadius(world, id);
    if (world.props.types[id] === PROP.largeRock) return touching;
    if (distance <= FOREST_RADIUS) trunksNear++;
    onTrunk ||= touching;
    return false;
  });
  return !onRock && (!onTrunk || trunksNear < FOREST_TRUNKS);
};
/** Worker footprint against adjacent water/foundations; authored passage permissions remain explicit. */
export const isNavigationFootprintClear = (
  context: SettlementContext, point: SettlementPoint,
  allowFoundation: (sample: SettlementPoint) => boolean = () => false,
  radius = .2
) => isFootprintClear(context, point, allowFoundation, radius,
  probe => isPublicBuildingPointClear(context, probe, 0));
/** A horse's footprint: a probe the fast path finds surely clear needs no building query (same answer). */
const isMountedFootprintClear = (context: SettlementContext, point: SettlementPoint) =>
  isFootprintClear(context, point, () => false, MOUNTED_NAVIGATION_RADIUS,
    probe => isFootprintProbeSurelyClear(context, probe) || isPublicBuildingPointClear(context, probe, 0));
const isFootprintClear = (
  context: SettlementContext, point: SettlementPoint, allowFoundation: (sample: SettlementPoint) => boolean,
  radius: number, isProbeClear: (probe: SettlementPoint) => boolean
) => {
  if (!isNavigationClear(context, point, allowFoundation(point))) return false;
  if (!allowFoundation(point) && !isPublicBuildingPointClear(context, point, radius)) return false;
  return everyFootprintProbe(context.options.world, point, radius, (probe, cell) =>
    isWalkableGround(context, cell, probe) && (allowFoundation(probe) || isProbeClear(probe)));
};

/** Cache mounted clearance only within one synchronous order; terrain cannot go stale between frames. */
const mountedOrderCaches = new WeakMap<SettlementContext, Map<string, boolean>>();
export const withMilitaryNavigationCache = <T>(context: SettlementContext, action: () => T): T => {
  if (mountedOrderCaches.has(context)) return action();
  mountedOrderCaches.set(context, new Map());
  try { return action(); } finally { mountedOrderCaches.delete(context); }
};
/** Mounted circles include body clearance around trees and boulders, not only terrain cells. */
export const isMountedNavigationClear = (context: SettlementContext, point: SettlementPoint) => {
  const cache = mountedOrderCaches.get(context);
  const key = cache && `${point.x}:${point.z}`;
  const known = key === undefined ? undefined : cache!.get(key);
  if (known !== undefined) { trafficWork.navigationCacheHits++; return known; }
  // A rider crosses a completed bridge on the deck's inner lane (see `isOnMountedDeckLane`). Inside a
  // search a certain answer from the gathered surroundings skips the full test (same result).
  const clear = isMountedPointSurelyClear(context, point) || isOnMountedDeckLane(context, point) ||
    (isMountedFootprintClear(context, point) &&
    isNavigationClear(context, point, false, false, MOUNTED_NAVIGATION_RADIUS));
  if (key !== undefined && cache!.size < 100_000) cache!.set(key, clear);
  return clear;
};

/** A newly planted/grown blocker may overlap an existing unit: permit only continuous outward motion. */
export const isNavigationEscapeClear = (context:SettlementContext, from:SettlementPoint, to:SettlementPoint,
  allowFoundation=false) => {
  const {world}=context.options;
  if(to.x<.12 || to.z<.12 || to.x>=world.cellsX-.12 || to.z>=world.cellsZ-.12)return false;
  const cell=Math.floor(to.z)*world.cellsX+Math.floor(to.x);
  const leavingPlot = isUnbuiltPlotEscape(context, from, to);
  if(!isWalkableGround(context, cell, to) ||
    (!allowFoundation && !isPublicBuildingPointClear(context,to) && !leavingPlot))return false;
  const camp = campEscape(adventureCampNavigationIndex(context), from, to);
  if (!camp.allowed) return false;
  let escaping=camp.escaping || leavingPlot;
  // A trunk the move ends inside is passable only while leaving it (started inside, moving outward).
  const blocked = someObstacleNear(world, Math.floor(to.x), Math.floor(to.z), 2, id => {
    const px=world.props.x[id]!,pz=world.props.z[id]!,radius=navigationPropRadius(world,id);
    const start=DMath.hypot(from.x-px,from.z-pz),end=DMath.hypot(to.x-px,to.z-pz);
    if(end>=radius)return false;
    if(start>=radius || end<=start+1e-7)return true;
    escaping=true;
    return false;
  });
  return !blocked && escaping;
};
/** Validate the whole edge: endpoints/midpoint alone miss small trunks between samples. */
/** Terrain sample spacing along a ground segment. */
const SEGMENT_SAMPLE_STEP = .05;
/** Exact test of a straight segment against tree trunks and boulders (closest point per prop). */
const testGroundSegmentProps = (context: SettlementContext, from: SettlementPoint, to: SettlementPoint,
  escapeInitialOverlap: boolean) => {
  const { world } = context.options;
  const dx = to.x - from.x, dz = to.z - from.z;
  const minX = Math.floor(Math.min(from.x, to.x)) - PROP_SEGMENT_REACH, maxX = Math.floor(Math.max(from.x, to.x)) + PROP_SEGMENT_REACH;
  const minZ = Math.floor(Math.min(from.z, to.z)) - PROP_SEGMENT_REACH, maxZ = Math.floor(Math.max(from.z, to.z)) + PROP_SEGMENT_REACH;
  return !someObstacleInCells(world, minX, minZ, maxX, maxZ, id => {
    const fraction = segmentFraction(world.props.x[id]!, world.props.z[id]!, from.x, from.z, dx, dz);
    if(escapeInitialOverlap && fraction===0 && DMath.hypot(from.x-world.props.x[id]!,from.z-world.props.z[id]!)<navigationPropRadius(world,id) &&
      (from.x-world.props.x[id]!)*dx+(from.z-world.props.z[id]!)*dz>=0)return false;
    return DMath.hypot(from.x + dx * fraction - world.props.x[id]!, from.z + dz * fraction - world.props.z[id]!) < navigationPropRadius(world, id);
  });
};
/** Cells round a segment's tiles whose trunks the segment test reads. */
const PROP_SEGMENT_REACH = 2;
/**
 * Half-grid edge results per world: one allocation per world size, cleared wholesale on an
 * unexplained change (navigation epoch) and otherwise only round the blocks marked since the stamp.
 */
interface PropEdgeCache { edges: Uint8Array; epoch: number; stamp: number }
const propEdgeCaches = new WeakMap<WorldData, PropEdgeCache>();
/** Tiles round a changed tile whose edges read it: the segment reach plus the half-grid step into the next tile. */
const PROP_EDGE_REACH = PROP_SEGMENT_REACH + 1;
const clearPropEdgeSlots = (cache: PropEdgeCache, world: WorldData, rect: TileRect) => {
  const stride = world.cellsX * 2 + 1;
  const fromX = Math.max(0, 2 * (rect.minX - PROP_EDGE_REACH)), toX = Math.min(world.cellsX * 2, 2 * (rect.maxX + PROP_EDGE_REACH) + 1);
  const fromZ = Math.max(0, 2 * (rect.minZ - PROP_EDGE_REACH)), toZ = Math.min(world.cellsZ * 2, 2 * (rect.maxZ + PROP_EDGE_REACH) + 1);
  for (let az = fromZ; az <= toZ; az++) cache.edges.fill(0, (az * stride + fromX) * 8, (az * stride + toX + 1) * 8);
};
const propEdgeCache = (world: WorldData) => {
  const epoch = worldNavigationEpoch(world), revision = navigationChangeRevision(world);
  const size = (world.cellsX * 2 + 1) * (world.cellsZ * 2 + 1) * 8;
  const known = propEdgeCaches.get(world);
  if (!known || known.edges.length !== size) {
    const created = { edges: new Uint8Array(size), epoch, stamp: revision };
    propEdgeCaches.set(world, created);
    return created;
  }
  if (known.epoch !== epoch) {
    known.edges.fill(0);
    known.epoch = epoch;
  } else if (known.stamp !== revision) {
    for (const block of markedNavigationBlocks(world, worldTileRect(world), known.stamp)) clearPropEdgeSlots(known, world, block);
  }
  known.stamp = revision;
  return known;
};
/** Half-grid edges recur across resource searches; cache their exact prop intersection result. */
const isGroundSegmentClearOfProps = (
  context: SettlementContext, from: SettlementPoint, to: SettlementPoint, escapeInitialOverlap: boolean
) => {
  const { world } = context.options;
  const ax = from.x * 2, az = from.z * 2, bx = to.x * 2, bz = to.z * 2;
  const dx = bx - ax, dz = bz - az;
  const gridEdge = Number.isInteger(ax) && Number.isInteger(az) && Number.isInteger(bx) && Number.isInteger(bz) &&
    Math.max(Math.abs(dx), Math.abs(dz)) === 1;
  if (escapeInitialOverlap || world.buildRevision === undefined || !gridEdge ||
    Math.min(ax, bx, az, bz) < 0 || Math.max(ax, bx) > world.cellsX * 2 || Math.max(az, bz) > world.cellsZ * 2)
    return testGroundSegmentProps(context, from, to, escapeInitialOverlap);
  const cache = propEdgeCache(world);
  const direction = (dz + 1) * 3 + dx + 1;
  const slot = ((az * (world.cellsX * 2 + 1) + ax) * 8) + direction - Number(direction > 4);
  const saved = cache.edges[slot];
  if (saved) return saved === 1;
  const clear = testGroundSegmentProps(context, from, to, false);
  cache.edges[slot] = clear ? 1 : 2;
  return clear;
};
export const isGroundSegmentClear = (...args: Parameters<typeof isGroundSegmentClearImpl>) =>
  profileNavigationStage("ground.segmentClear", () => isGroundSegmentClearImpl(...args));
const isGroundSegmentClearImpl = (context: SettlementContext, from: SettlementPoint, to: SettlementPoint,
  isBlocked?: (point: SettlementPoint) => boolean, allowFoundation?: (point:SettlementPoint) => boolean,
  escapeInitialOverlap=false, allowDryBeach?: (point: SettlementPoint) => boolean) => {
  if (!isGroundSegmentClearOfProps(context, from, to, escapeInitialOverlap)) return false;
  const leavingPlot = isUnbuiltPlotEscape(context, from, to);
  return everySegmentSample(from, to, point =>
    isSampleClear(context, from, point, escapeInitialOverlap || leavingPlot, allowFoundation, allowDryBeach) &&
    !isBlocked?.(point));
};
/** Every sample along the segment (its end included, its start not) passes `test`. */
const everySegmentSample = (from: SettlementPoint, to: SettlementPoint, test: (point: SettlementPoint) => boolean) => {
  const dx = to.x - from.x, dz = to.z - from.z;
  const steps = Math.max(1, Math.ceil(DMath.hypot(dx, dz) / SEGMENT_SAMPLE_STEP));
  for (let step = 1; step <= steps; step++)
    if (!test({ x: from.x + dx * step / steps, z: from.z + dz * step / steps })) return false;
  return true;
};
/**
 * `isGroundSegmentClear` with the horse's clearance as the blocker. A sample the fast path finds surely
 * clear passes both tests at once (the horse's test includes the terrain sample test), the same answer.
 */
export const isMountedGroundSegmentClear = (context: SettlementContext, from: SettlementPoint, to: SettlementPoint) =>
  profileNavigationStage("ground.segmentClear", () => {
    if (!isGroundSegmentClearOfProps(context, from, to, false)) return false;
    if (isMountedSegmentSurelyClear(context, from, to, test => everySegmentSample(from, to, test))) return true;
    const leavingPlot = isUnbuiltPlotEscape(context, from, to);
    return everySegmentSample(from, to, point => isMountedPointSurelyClear(context, point) ||
      (isSampleClear(context, from, point, leavingPlot) && isMountedNavigationClear(context, point)));
  });
/** Props were already tested exactly along the whole segment, so plain samples need terrain only. */
const isSampleClear = (context: SettlementContext, from: SettlementPoint, point: SettlementPoint,
  escapeInitialOverlap: boolean, allowFoundation?: (point: SettlementPoint) => boolean,
  allowDryBeach?: (point: SettlementPoint) => boolean) => {
  if (!escapeInitialOverlap) return isTerrainClear(context, point, allowFoundation?.(point), allowDryBeach?.(point)) &&
    context.roadDecorations?.isSupportClear(point) !== false;
  return isNavigationClear(context, point, allowFoundation?.(point), allowDryBeach?.(point)) ||
    isNavigationEscapeClear(context, from, point, allowFoundation?.(point));
};
const DEFAULT_NODE_STEP = .5;
const DEFAULT_MAXIMUM_VISITS = 16384;
type GroundSearchArgs = [context: SettlementContext, from: SettlementPoint, to: SettlementPoint,
  isBlocked?: (point: SettlementPoint) => boolean, allowFoundation?: (point: SettlementPoint) => boolean,
  nodeStep?: number, maximumVisits?: number, allowDryBeach?: (point: SettlementPoint) => boolean];
const runGroundSearch = (args: GroundSearchArgs, explored: ExploredTiles | null) =>
  withBuildingNavigationSearch(args[0], () => searchGroundPathImpl(explored, ...args));
/**
 * Searches without predicate callbacks read only journaled navigation state, so their failures go
 * through the exact negative-result memo (A07); every other search runs as before.
 */
const searchThroughMemo = (args: GroundSearchArgs): GroundSearchResult => {
  const [context, from, to, isBlocked, allowFoundation, nodeStep = DEFAULT_NODE_STEP,
    maximumVisits = DEFAULT_MAXIMUM_VISITS, allowDryBeach] = args;
  if (isBlocked || allowFoundation || allowDryBeach) return runGroundSearch(args, null);
  const key = `${from.x},${from.z}>${to.x},${to.z}/${nodeStep}/${maximumVisits}`;
  return memoisedGroundSearch(context, key, nodeStep, explored => runGroundSearch(args, explored));
};
/** Half-cell routing leaves room to pass a trunk within a costly, otherwise walkable forest cell. */
export const searchGroundPath = (...args: GroundSearchArgs) =>
  profileNavigationStage("ground.search", () => searchThroughMemo(args));
const searchGroundPathImpl = (explored: ExploredTiles | null, context: SettlementContext, from: SettlementPoint,
  to: SettlementPoint, isBlocked?: (point: SettlementPoint) => boolean,
  allowFoundation?: (point:SettlementPoint) => boolean, nodeStep = DEFAULT_NODE_STEP,
  maximumVisits = DEFAULT_MAXIMUM_VISITS, allowDryBeach?: (point: SettlementPoint) => boolean): GroundSearchResult => {
  trafficWork.groundSearches++;
  const { world } = context.options;
  noteExploredPoint(explored, from.x, from.z);
  noteExploredPoint(explored, to.x, to.z);
  noteGroundSearchRead(from.x, from.z);
  noteGroundSearchRead(to.x, to.z);
  if (!isNavigationClear(context, to, allowFoundation?.(to), allowDryBeach?.(to)) || isBlocked?.(to))
    return { status: "no-path" as const, path: null, visits: 0 };
  const adaptive = nodeStep === .5 && context.buildings.length > 0, quantum = adaptive ? .125 : nodeStep;
  const stride = world.cellsX / quantum + 1;
  const node = (point: SettlementPoint) => Math.round(point.z / quantum) * stride + Math.round(point.x / quantum);
  const point = (id: number) => ({ x: (id % stride) * quantum, z: Math.floor(id / stride) * quantum });
  const start = node(from), end = node(to);
  const parents = new Map<number, number>([[start, -1]]);
  const costs = new Map<number, number>([[start, 0]]);
  const frontier = createPathFrontier();
  frontier.push(start, 0, DMath.hypot(from.x - to.x, from.z - to.z));
  for (let visited = 0; visited < maximumVisits; visited++) {
    const entry = frontier.pop();
    trafficWork.groundVisits++;
    if (!entry) return { status: "no-path" as const, path: null, visits: visited };
    const current = entry.id;
    if (entry.cost !== costs.get(current)) continue;
    const position = point(current);
    noteExploredPoint(explored, position.x, position.z);
    noteGroundSearchRead(position.x, position.z);
    // Open land advances on a coarse lattice. Its phase may differ from the fine-grid goal;
    // finish with a checked physical edge rather than searching forever for an unreachable node ID.
    const closeToGoal = adaptive && DMath.hypot(position.x - to.x, position.z - to.z) <= nodeStep;
    const finalEdge = closeToGoal && isGroundSegmentClear(context, current === start ? from : position,
      to, isBlocked, allowFoundation, current === start, allowDryBeach);
    if (current === end || finalEdge) {
      if (current === start && !isGroundSegmentClear(context, from, to, isBlocked, allowFoundation,
        false, allowDryBeach))
        return { status: "no-path" as const, path: null, visits: visited + 1 };
      const path: SettlementPoint[] = [to];
      let previous = current === end ? parents.get(current)! : current;
      while (previous >= 0 && previous !== start) {
        path.push(point(previous)); previous = parents.get(previous)!;
      }
      return { status: "found" as const, path: path.reverse(), visits: visited + 1 };
    }
    const step = adaptive && hasBuildingNavigationNearby(context, position) ? .125 : nodeStep;
    for (const [dx, dz] of [[step, 0], [0, step], [-step, 0], [0, -step],
      [step, step], [-step, step], [step, -step], [-step, -step]]) {
      const next = { x: position.x + dx!, z: position.z + dz! };
      const id = node(next);
      const cost = entry.cost + DMath.hypot(next.x - position.x, next.z - position.z);
      if ((costs.get(id) ?? Infinity) <= cost || !isGroundSegmentClear(context, current === start ? from : position,
        id === end ? to : next, isBlocked, allowFoundation, current===start, allowDryBeach)) continue;
      costs.set(id, cost);
      parents.set(id, current);
      frontier.push(id, cost, cost + DMath.hypot(next.x - to.x, next.z - to.z));
    }
  }
  countNavigation("ground.budgetExhausted");
  return { status: "budget-exhausted" as const, path: null, visits: maximumVisits };
};

/** Legacy callers retain nullable paths; recovery callers can distinguish exhausted searches. */
export const findGroundPath = (...args: Parameters<typeof searchGroundPath>) => searchGroundPath(...args).path;
