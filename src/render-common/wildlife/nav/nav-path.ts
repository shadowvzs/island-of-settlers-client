import { MinHeap } from "../../../shared/world/min-heap";
import { createPathWorkspace } from "./nav-path-workspace";
import { isSegmentWalkable, type NavWorld } from "./nav-query";
import { NAV_CELL, NAV_RES } from "./nav-terrain";

/** Waypoints an animal keeps (x, z pairs); longer routes are re-planned at their end. */
export const MAX_PATH_POINTS = 10;
/** A* gives up after this many expanded nav cells (wander and flee targets are near). */
const MAX_EXPANSIONS = 5000;
const MAX_ROUTE_CELLS = 2048;
const START_SEARCH_RING = 2;
const DIAGONAL = Math.SQRT2;
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1]
];

const getOctile = (dx: number, dz: number) => {
  const ax = Math.abs(dx);
  const az = Math.abs(dz);
  return Math.max(ax, az) + (DIAGONAL - 1) * Math.min(ax, az);
};

/**
 * Coarse grid path on the species' open nav cells (A*, 8 neighbours, no corner cutting, slope
 * makes cells dearer), then string pulled with the exact segment validation, so an animal walks
 * straight wherever it can. Preallocated: no allocation per query.
 */
export const createPathFinder = (nav: NavWorld) => {
  const { depth, width } = nav.terrain;
  const workspace = createPathWorkspace(width, depth);
  const route = new Int32Array(MAX_ROUTE_CELLS);
  const heap = new MinHeap(1024);
  const openCell = (open: Uint8Array, cell: number) => !!open[cell] &&
    !nav.isExcluded?.(((cell % width) + 0.5) * NAV_CELL,
      (Math.floor(cell / width) + 0.5) * NAV_CELL, NAV_CELL / 2);

  /** Nearest open cell (ring search) to a point, -1 when none is close. */
  const findOpenCell = (open: Uint8Array, x: number, z: number) => {
    const column = Math.floor(x * NAV_RES);
    const row = Math.floor(z * NAV_RES);
    for (let ring = 0; ring <= START_SEARCH_RING; ring += 1) {
      for (let dz = -ring; dz <= ring; dz += 1) {
        for (let dx = -ring; dx <= ring; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const c = column + dx;
          const r = row + dz;
          if (c < 0 || r < 0 || c >= width || r >= depth) continue;
          if (openCell(open, r * width + c)) return r * width + c;
        }
      }
    }
    return -1;
  };

  const visit = (cell: number, from: number, value: number, goal: number) => {
    if (workspace.isSeen(cell) && workspace.cost(cell) <= value) return;
    workspace.markSeen(cell);
    workspace.setCost(cell, value);
    workspace.setParent(cell, from);
    const dx = (cell % width) - (goal % width);
    const dz = Math.floor(cell / width) - Math.floor(goal / width);
    heap.push(cell, value + getOctile(dx, dz));
  };

  const expand = (open: Uint8Array, cell: number, goal: number) => {
    const column = cell % width;
    const row = Math.floor(cell / width);
    for (const [dx, dz] of NEIGHBOURS) {
      const c = column + dx;
      const r = row + dz;
      if (c < 0 || r < 0 || c >= width || r >= depth) continue;
      const next = r * width + c;
      if (!openCell(open, next) || workspace.isDone(next)) continue;
      const diagonal = dx !== 0 && dz !== 0;
      if (diagonal && (!openCell(open, row * width + c) || !openCell(open, r * width + column))) continue;
      const step = (diagonal ? DIAGONAL : 1) * (1 + nav.terrain.slope[next]!);
      visit(next, cell, workspace.cost(cell) + step, goal);
    }
  };

  const search = (open: Uint8Array, start: number, goal: number) => {
    workspace.begin();
    while (heap.size > 0) heap.pop();
    visit(start, -1, 0, goal);
    for (let expanded = 0; heap.size > 0 && expanded < MAX_EXPANSIONS; expanded += 1) {
      const cell = heap.pop();
      if (workspace.isDone(cell)) continue;
      if (cell === goal) return true;
      workspace.markDone(cell);
      expand(open, cell, goal);
    }
    return false;
  };

  /** Route cells from start to goal into `route`; returns their count. */
  const collectRoute = (goal: number) => {
    let count = 0;
    for (let cell = goal; cell !== -1 && count < MAX_ROUTE_CELLS; cell = workspace.parent(cell)) {
      route[count++] = cell;
    }
    route.subarray(0, count).reverse();
    return count;
  };

  const centreX = (cell: number) => ((cell % width) + 0.5) * NAV_CELL;
  const centreZ = (cell: number) => (Math.floor(cell / width) + 0.5) * NAV_CELL;

  const canReach = (species: number, fromX: number, fromZ: number, cell: number) =>
    isSegmentWalkable(nav, species, fromX, fromZ, centreX(cell), centreZ(cell));

  /** Greedy string pulling: from each anchor, the farthest route cell still in straight reach. */
  const pullString = (
    species: number,
    count: number,
    startX: number,
    startZ: number,
    out: Float32Array,
    base: number
  ) => {
    let points = 0;
    let anchorX = startX;
    let anchorZ = startZ;
    let index = 1;
    while (index < count && points < MAX_PATH_POINTS) {
      let reach = index;
      while (reach + 1 < count && canReach(species, anchorX, anchorZ, route[reach + 1]!)) {
        reach += 1;
      }
      anchorX = centreX(route[reach]!);
      anchorZ = centreZ(route[reach]!);
      out[base + points * 2] = anchorX;
      out[base + points * 2 + 1] = anchorZ;
      points += 1;
      index = reach + 1;
    }
    return points;
  };

  /**
   * Path for a species from (startX, startZ) towards (targetX, targetZ): waypoints (x, z) into
   * `out` from `base` (MAX_PATH_POINTS pairs), the count returned, 0 when there is no route. The last point
   * is the target itself when it is in straight reach of the route's end.
   */
  const findPath = (
    species: number,
    startX: number,
    startZ: number,
    targetX: number,
    targetZ: number,
    out: Float32Array,
    base = 0
  ) => {
    const { open, region } = nav.species[species]!;
    const start = findOpenCell(open, startX, startZ);
    const goal = findOpenCell(open, targetX, targetZ);
    if (start < 0 || goal < 0 || region[start] !== region[goal]) return 0;
    if (!search(open, start, goal)) return 0;
    const count = pullString(species, collectRoute(goal), startX, startZ, out, base);
    if (count >= MAX_PATH_POINTS) return count;
    const lastX = count > 0 ? out[base + (count - 1) * 2]! : startX;
    const lastZ = count > 0 ? out[base + (count - 1) * 2 + 1]! : startZ;
    if (!isSegmentWalkable(nav, species, lastX, lastZ, targetX, targetZ)) return count;
    out[base + count * 2] = targetX;
    out[base + count * 2 + 1] = targetZ;
    return count + 1;
  };

  return { findPath };
};

export type PathFinder = ReturnType<typeof createPathFinder>;
