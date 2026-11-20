import { ROUTE_EXPANSIONS, ROUTE_EXPOSURE_WEIGHT, ROUTE_WAYPOINTS } from "../../balance/retreat-route";
import { influenceCellOf, type InfluenceMap, writeInfluenceCellCentre } from "../military-influence-map";
import type { SettlementPoint } from "../settlement-types";

/**
 * Covered retreat router (A14 plan §3.4): a count-bounded search over the influence cells from a walker's cell
 * to its goal, where entering a cell costs its length times `1 + ROUTE_EXPOSURE_WEIGHT · enemy influence`. It is
 * Dijkstra ordered by cost plus the octile distance still to go (an admissible bound, so the first route to the
 * goal is the cheapest), with integer costs and ties by cell index: the same inputs give the same route on every
 * machine. At most `ROUTE_EXPANSIONS` cells are expanded; if the goal is not reached, the route ends at the
 * expanded cell nearest the goal. Cells are checked for clear ground lazily, when expanded.
 */

/** A step's length: orthogonal 10, diagonal 14 (octile, integers). */
const ORTHOGONAL = 10;
const DIAGONAL = 14;
/** One unit of cost per length unit; exposure adds `ROUTE_EXPOSURE_WEIGHT · influence` units. */
const UNIT = 100;
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]
];
const HEAP_CAPACITY = ROUTE_EXPANSIONS * NEIGHBOURS.length + 1;

/** A searched route (reused by the router: read it before the next search). */
export interface RetreatRoute {
  /** Up to `ROUTE_WAYPOINTS` points to walk to in order; the first is the next leg. */
  waypoints: SettlementPoint[];
  /** The route ends at the goal (else at the expanded cell nearest it). */
  reached: boolean;
  /** No cell beyond the walker's own could be entered: there is no way out. */
  blocked: boolean;
  /** Enemy influence summed along the route's cells and along the straight cell line to its end (×length). */
  exposure: number;
  straightExposure: number;
  expansions: number;
}

/** Octile length (in step units) between two cells' column/row offsets. */
const octile = (dx: number, dz: number) => {
  const ax = Math.abs(dx), az = Math.abs(dz);
  return ORTHOGONAL * Math.max(ax, az) + (DIAGONAL - ORTHOGONAL) * Math.min(ax, az);
};

/** A binary min-heap of cells by key (ties: the lower cell index), on fixed typed arrays. */
const createCellHeap = (capacity: number) => {
  const heapCells = new Int32Array(capacity), heapKeys = new Float64Array(capacity);
  let heapSize = 0;
  const before = (a: number, b: number) =>
    heapKeys[a]! < heapKeys[b]! || (heapKeys[a] === heapKeys[b] && heapCells[a]! < heapCells[b]!);
  const swap = (a: number, b: number) => {
    const cell = heapCells[a]!, key = heapKeys[a]!;
    heapCells[a] = heapCells[b]!; heapKeys[a] = heapKeys[b]!;
    heapCells[b] = cell; heapKeys[b] = key;
  };
  const push = (cell: number, key: number) => {
    if (heapSize >= capacity) return;
    let index = heapSize++;
    heapCells[index] = cell; heapKeys[index] = key;
    while (index > 0) {
      const up = (index - 1) >> 1;
      if (!before(index, up)) break;
      swap(index, up);
      index = up;
    }
  };
  const pop = () => {
    const cell = heapCells[0]!;
    heapSize--;
    if (heapSize > 0) {
      heapCells[0] = heapCells[heapSize]!; heapKeys[0] = heapKeys[heapSize]!;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1, right = left + 1;
        let first = index;
        if (left < heapSize && before(left, first)) first = left;
        if (right < heapSize && before(right, first)) first = right;
        if (first === index) break;
        swap(index, first);
        index = first;
      }
    }
    return cell;
  };
  return { clear: () => { heapSize = 0; }, pop, push, size: () => heapSize };
};

/**
 * Visits the 8-connected cell line from `from` to `to` (Bresenham over a grid `columns` wide, `from` excluded) with
 * each step's length; stops early when `visit` returns false. Returns whether every cell was visited.
 */
const walkCellLine = (
  columns: number, from: number, to: number, visit: (cell: number, length: number) => boolean
) => {
  let x = from % columns, z = Math.floor(from / columns);
  const toX = to % columns, toZ = Math.floor(to / columns);
  const dx = Math.abs(toX - x), dz = -Math.abs(toZ - z), sx = x < toX ? 1 : -1, sz = z < toZ ? 1 : -1;
  let error = dx + dz;
  while (x !== toX || z !== toZ) {
    const doubled = 2 * error;
    let movedX = false, movedZ = false;
    if (doubled >= dz) { error += dz; x += sx; movedX = true; }
    if (doubled <= dx) { error += dx; z += sz; movedZ = true; }
    if (!visit(z * columns + x, movedX && movedZ ? DIAGONAL : ORTHOGONAL)) return false;
  }
  return true;
};

export const createRetreatRouter = (map: InfluenceMap) => {
  const size = map.columns * map.rows;
  const cost = new Float64Array(size), parent = new Int32Array(size);
  const seen = new Int32Array(size), closed = new Int32Array(size);
  const clearAt = new Int32Array(size), clearValue = new Uint8Array(size);
  const exposureAt = new Int32Array(size), exposureValue = new Float64Array(size);
  const heap = createCellHeap(HEAP_CAPACITY);
  const path = new Int32Array(ROUTE_EXPANSIONS + 1);
  const result: RetreatRoute = {
    blocked: false, expansions: 0, exposure: 0, reached: false, straightExposure: 0, waypoints: []
  };
  let generation = 0, faction = 0, goalCell = 0, goalColumn = 0, goalRow = 0;
  let isClear: (point: SettlementPoint) => boolean = () => true;
  const scratch: SettlementPoint = { x: 0, z: 0 };

  /**
   * The enemy layers in ascending faction order: a map's layers are kept in creation order, which differs between
   * a live run and a reloaded one, and float sums must not depend on it.
   */
  const sides: number[] = [], enemyLayers: Float32Array[] = [];
  const prepareLayers = () => {
    if (sides.length !== map.layers.size) {
      sides.length = 0;
      for (const side of map.layers.keys()) sides.push(side);
      sides.sort((first, second) => first - second);
    }
    enemyLayers.length = 0;
    for (const side of sides) if (side !== faction) enemyLayers.push(map.layers.get(side)!);
  };
  /** Raw enemy influence of a cell (cached per search). */
  const influenceOf = (cell: number) => {
    if (exposureAt[cell] !== generation) {
      exposureAt[cell] = generation;
      let total = 0;
      for (const layer of enemyLayers) total += layer[cell]!;
      exposureValue[cell] = total;
    }
    return exposureValue[cell]!;
  };
  const stepCost = (cell: number, length: number) =>
    length * (UNIT + Math.round(ROUTE_EXPOSURE_WEIGHT * UNIT * influenceOf(cell)));
  const remaining = (cell: number) =>
    UNIT * octile(goalColumn - (cell % map.columns), goalRow - Math.floor(cell / map.columns));
  /** Clear ground at the cell's centre (the goal cell: at the goal itself), cached per search. */
  const clear = (cell: number, goal: SettlementPoint) => {
    if (clearAt[cell] !== generation) {
      clearAt[cell] = generation;
      const point = cell === goalCell ? goal : writeInfluenceCellCentre(map, cell, scratch);
      clearValue[cell] = isClear(point) ? 1 : 0;
    }
    return clearValue[cell] === 1;
  };

  const relax = (cell: number) => {
    const column = cell % map.columns, row = Math.floor(cell / map.columns);
    for (const [dx, dz] of NEIGHBOURS) {
      const x = column + dx, z = row + dz;
      if (x < 0 || z < 0 || x >= map.columns || z >= map.rows) continue;
      const next = z * map.columns + x;
      if (closed[next] === generation) continue;
      const total = cost[cell]! + stepCost(next, dx && dz ? DIAGONAL : ORTHOGONAL);
      if (seen[next] === generation && total >= cost[next]!) continue;
      seen[next] = generation;
      cost[next] = total;
      parent[next] = cell;
      heap.push(next, total + remaining(next));
    }
  };
  /** Nearer the goal first, then cheaper, then the lower cell index. */
  const isBetterEnd = (cell: number, best: number) => {
    if (best < 0) return true;
    const gap = remaining(cell) - remaining(best);
    if (gap !== 0) return gap < 0;
    return cost[cell]! < cost[best]! || (cost[cell] === cost[best] && cell < best);
  };

  /** The search itself: returns the route's last cell (-1: no cell beyond the start could be entered). */
  const search = (start: number, goal: SettlementPoint) => {
    heap.clear();
    seen[start] = generation; cost[start] = 0; parent[start] = -1;
    heap.push(start, remaining(start));
    let best = -1, expansions = 0;
    while (heap.size() > 0 && expansions < ROUTE_EXPANSIONS) {
      const cell = heap.pop();
      if (closed[cell] === generation) continue;
      closed[cell] = generation;
      expansions++;
      if (cell !== start && !clear(cell, goal)) continue;
      if (cell === goalCell) { best = cell; result.reached = true; break; }
      if (cell !== start && isBetterEnd(cell, best)) best = cell;
      relax(cell);
    }
    result.expansions = expansions;
    return best;
  };

  /** Writes the cells start..end into `path`; returns the count. */
  const tracePath = (end: number) => {
    let count = 0;
    for (let cell = end; cell >= 0; cell = parent[cell]!) path[count++] = cell;
    path.subarray(0, count).reverse();
    return count;
  };

  let lineLimit = 0, lineSum = 0;
  /** A shortcut cell: checked clear in this search and no more exposed than the route it replaces. */
  const coveredCell = (cell: number) =>
    clearAt[cell] === generation && clearValue[cell] === 1 && influenceOf(cell) <= lineLimit;
  const addExposure = (cell: number, length: number) => {
    lineSum += influenceOf(cell) * length;
    return true;
  };
  /** The highest enemy influence on the route's cells after `from` up to `to` (indices into `path`). */
  const peakBetween = (from: number, to: number) => {
    let peak = 0;
    for (let index = from + 1; index <= to; index++) peak = Math.max(peak, influenceOf(path[index]!));
    return peak;
  };
  /** The route's point at `path[index]`: the goal itself at the goal cell. */
  const pointAt = (index: number, goal: SettlementPoint) => {
    const cell = path[index]!;
    if (cell === goalCell && result.reached) return { x: goal.x, z: goal.z };
    return writeInfluenceCellCentre(map, cell, { x: 0, z: 0 });
  };
  /**
   * Turning points: from each waypoint the leg runs straight as far along the route as the straight cell line
   * stays on checked clear cells no more exposed than the route's own worst cell there.
   */
  const writeWaypoints = (count: number, goal: SettlementPoint) => {
    let anchor = 0;
    while (anchor < count - 1 && result.waypoints.length < ROUTE_WAYPOINTS) {
      let end = anchor + 1;
      while (end + 1 < count) {
        lineLimit = peakBetween(anchor, end + 1);
        if (!walkCellLine(map.columns, path[anchor]!, path[end + 1]!, coveredCell)) break;
        end++;
      }
      result.waypoints.push(pointAt(end, goal));
      anchor = end;
    }
  };
  const writeExposure = (count: number) => {
    let sum = 0;
    for (let index = 1; index < count; index++) {
      const previous = path[index - 1]!, cell = path[index]!;
      const diagonal = previous % map.columns !== cell % map.columns &&
        Math.floor(previous / map.columns) !== Math.floor(cell / map.columns);
      sum += influenceOf(cell) * (diagonal ? DIAGONAL : ORTHOGONAL);
    }
    result.exposure = sum / ORTHOGONAL;
    lineSum = 0;
    walkCellLine(map.columns, path[0]!, path[count - 1]!, addExposure);
    result.straightExposure = lineSum / ORTHOGONAL;
  };

  /**
   * The covered route of `side` from `from` to `goal` over the map as last filled. `clearTest` tells clear ground
   * (walkable for a soldier). The result is reused: copy what is kept.
   */
  const route = (
    side: number, from: SettlementPoint, goal: SettlementPoint, clearTest: (point: SettlementPoint) => boolean
  ): Readonly<RetreatRoute> => {
    generation++;
    faction = side;
    isClear = clearTest;
    prepareLayers();
    goalCell = influenceCellOf(map, goal);
    goalColumn = goalCell % map.columns;
    goalRow = Math.floor(goalCell / map.columns);
    result.waypoints.length = 0;
    result.reached = false;
    result.exposure = 0;
    result.straightExposure = 0;
    const start = influenceCellOf(map, from);
    if (start === goalCell) {
      result.blocked = false;
      result.expansions = 0;
      result.reached = true;
      result.waypoints.push({ x: goal.x, z: goal.z });
      return result;
    }
    const end = search(start, goal);
    result.blocked = end < 0;
    if (end < 0) return result;
    const count = tracePath(end);
    writeWaypoints(count, goal);
    writeExposure(count);
    return result;
  };
  return { route };
};

export type RetreatRouter = ReturnType<typeof createRetreatRouter>;
