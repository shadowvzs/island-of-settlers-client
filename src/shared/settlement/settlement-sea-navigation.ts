import { SAILING_SHIP_SPACING, SAILING_SHIP_TURN_RADIUS } from "../../render-common/ships/ship-dimensions";
import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { MinHeap } from "../world/min-heap";
import {
  captureSeaMaskSource, SEA_WET_DEPTH, type SeaMaskSource, seaMaskSourceHolds
} from "../world/sea-mask-source";
import type { WorldData } from "../world/world-data";
import { countNavigation, profileNavigationStage } from "./navigation-profile";
import { groundPath } from "./settlement-paths";
import { createSeaSearchWorkspaces, type SeaSearchWorkspace } from "./settlement-sea-search-workspace";
import { shipHullFitsSea } from "./settlement-ship-clearance";
import type { SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

export const SHIPYARD_RADIUS = 36;

const revisions = new WeakMap<Uint8Array, number>();
const coastalPaths = new WeakMap<SettlementContext, {
  revision: string;
  paths: Map<string, SettlementPoint[] | null>;
}>();

/** Moving ships change available berths, but not the carrier routes to their shore workpoints. */
const coastalPath = (context: SettlementContext, from: SettlementPoint, to: SettlementPoint) => {
  const { roads, world } = context.options;
  const revision = [world.buildRevision ?? 0, world.terrainRevision ?? 0,
    context.navigationRevision ?? 0, roads.revision ?? 0, world.props.count].join(":");
  let cache = coastalPaths.get(context);
  if (cache?.revision !== revision) {
    cache = { revision, paths: new Map() };
    coastalPaths.set(context, cache);
  }
  const key = `${from.x},${from.z}:${to.x},${to.z}`;
  if (cache.paths.has(key)) return cache.paths.get(key)!;
  const path = groundPath(context, from, to);
  // Bound retained routes on large islands; this cache never becomes part of a save.
  if (cache.paths.size >= 4096) cache.paths.delete(cache.paths.keys().next().value!);
  cache.paths.set(key, path);
  return path;
};

const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
/** Sea connected to the map border, with draft clearance; rivers and enclosed lakes are excluded. */
export const createSeaMask = (world: WorldData) =>
  profileNavigationStage("sea.mask", () => createSeaMaskImpl(world));
const createSeaMaskImpl = (world: WorldData) => {
  const wet = new Uint8Array(world.cellsX * world.cellsZ), sea = wet.slice();
  const vertices = world.cellsX + 1, { heights, lakeWater } = world, wetBelow = world.seaLevel - SEA_WET_DEPTH;
  const wetVertex = (index: number) => heights[index]! < wetBelow && !lakeWater?.[index];
  for (let z = 0; z < world.cellsZ; z++) for (let x = 0; x < world.cellsX; x++) {
    const top = z * vertices + x, bottom = top + vertices;
    if (wetVertex(top) && wetVertex(top + 1) && wetVertex(bottom) && wetVertex(bottom + 1))
      wet[z * world.cellsX + x] = 1;
  }
  const queue: number[] = [];
  for (let z = 0; z < world.cellsZ; z++) for (let x = 0; x < world.cellsX; x++) {
    const cell = z * world.cellsX + x;
    if ((x === 0 || z === 0 || x === world.cellsX - 1 || z === world.cellsZ - 1) && wet[cell]) {
      sea[cell] = 1; queue.push(cell);
    }
  }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const cell = queue[cursor]!, x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
    for (const [dx, dz] of directions) {
      const nx = x + dx, nz = z + dz, next = nz * world.cellsX + nx;
      if (nx < 0 || nz < 0 || nx >= world.cellsX || nz >= world.cellsZ || !wet[next] || sea[next]) continue;
      sea[next] = 1; queue.push(next);
    }
  }
  revisions.set(sea, world.terrainRevision ?? 0);
  return sea;
};
/** The heights each refreshed buffer was derived from (JETTY-FRAMES: dry edits keep the buffer). */
const sources = new WeakMap<Uint8Array, SeaMaskSource>();
/** Masks of derived immutable geometries: no terrain heights to record (e.g. the relief departure sea). */
const derivedMasks = new WeakSet<Uint8Array>();
/**
 * Refresh the shared buffer once per terrain revision; existing owners retain its identity. A revision
 * whose height edits all stay dry keeps the buffer as it is (it would be derived byte for byte again).
 */
export const refreshSeaMask = (world: WorldData, sea: Uint8Array) => {
  const revision = world.terrainRevision ?? 0;
  if (revisions.get(sea) === revision) return false;
  const source = sources.get(sea);
  revisions.set(sea, revision);
  if (source && seaMaskSourceHolds(world, source)) return false;
  sea.set(createSeaMask(world));
  sources.set(sea, captureSeaMaskSource(world));
  return true;
};
/**
 * A long-lived buffer (a route planner's sea) records the heights of its current revision now, so its
 * first terrain revision can already be compared instead of filled again.
 */
export const trackSeaMaskSource = (world: WorldData, sea: Uint8Array) => {
  if (derivedMasks.has(sea)) return;
  if (revisions.get(sea) === (world.terrainRevision ?? 0) && !sources.has(sea))
    sources.set(sea, captureSeaMaskSource(world));
};
/** A derived immutable routing geometry supplies its exact mask rather than regenerating terrain. */
export const registerDerivedSeaMask = (world: WorldData, sea: Uint8Array) => {
  if (sea.length !== world.cellsX * world.cellsZ) throw new Error("Derived sea dimensions disagree");
  revisions.set(sea, world.terrainRevision ?? 0);
  derivedMasks.add(sea);
};
/** Eight neighbours; diagonals only between two wet orthogonal cells (no cutting a dry corner). */
const neighbours = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]] as const;
const octile = (dx: number, dz: number) => Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
const searchWorkspaces = createSeaSearchWorkspaces();
/** Optional exact grid-edge predicate for callers whose geometry is already indexed by cell. */
export type SeaGridClearance = (from: number, to: number, dx: number, dz: number) => boolean;

/** A* over wet cells (octile steps and heuristic); the predecessor of every cell, null when cut off. */
const searchSeaCells = (world: WorldData, sea: Uint8Array, first: number, last: number,
  workspace: SeaSearchWorkspace,
  clear?: (from: SettlementPoint, to: SettlementPoint) => boolean,
  exhausted?: (reachable: Uint8Array) => void,
  clearGrid?: SeaGridClearance) => {
  const { closed, cost, generation, previous, seen, visited } = workspace, open = new MinHeap(256);
  let visitedCount = 0;
  const goalX = last % world.cellsX, goalZ = Math.floor(last / world.cellsX);
  const estimate = (x: number, z: number) => octile(Math.abs(goalX - x), Math.abs(goalZ - z));
  const wet = (x: number, z: number) => x >= 0 && z >= 0 && x < world.cellsX && z < world.cellsZ &&
    Boolean(sea[z * world.cellsX + x]);
  previous[first] = first; cost[first] = 0; seen[first] = generation; open.push(first, 0);
  try {
    while (open.size) {
      const cell = open.pop();
      if (cell === last) return previous;
      if (closed[cell] === generation) continue;
      closed[cell] = generation;
      visitedCount++;
      if (exhausted) visited[visitedCount - 1] = cell;
      const x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
      for (const [dx, dz] of neighbours) {
        const nx = x + dx, nz = z + dz, next = nz * world.cellsX + nx;
        if (!wet(nx, nz) || closed[next] === generation || (dx && dz && (!wet(x + dx, z) || !wet(x, z + dz)))) continue;
        const total = cost[cell]! + (dx && dz ? Math.SQRT2 : 1);
        if (total >= (seen[next] === generation ? cost[next]! : Infinity)) continue;
        if (clearGrid ? !clearGrid(cell, next, dx, dz)
          : clear && !clear({ x: x + .5, z: z + .5 }, { x: nx + .5, z: nz + .5 })) continue;
        previous[next] = cell; cost[next] = total; seen[next] = generation; open.push(next, total + estimate(nx, nz));
      }
    }
  } finally {
    countNavigation("sea.searches");
    countNavigation("sea.visits", visitedCount);
  }
  // There is no search budget here: only an empty frontier proves this complete reachable set.
  // A future node/time cap must return without emitting an exhaustion certificate.
  if (exhausted) {
    const reachable = new Uint8Array(closed.length);
    for (let index = 0; index < visitedCount; index++) reachable[visited[index]!] = 1;
    exhausted(reachable);
  }
  return null;
};

export const findSeaRoute = (...args: Parameters<typeof findSeaRouteImpl>) =>
  profileNavigationStage("sea.route", () => findSeaRouteImpl(...args));
const findSeaRouteImpl = (world: WorldData, sea: Uint8Array, from: SettlementPoint, to: SettlementPoint,
  clear?: (from: SettlementPoint, to: SettlementPoint) => boolean,
  exhausted?: (reachable: Uint8Array) => void,
  clearGrid?: SeaGridClearance) => {
  const index = (point: SettlementPoint) => Math.floor(point.z) * world.cellsX + Math.floor(point.x);
  if ([from, to].some((p) => p.x < 0 || p.z < 0 || p.x >= world.cellsX || p.z >= world.cellsZ)) return null;
  const first = index(from), last = index(to);
  if (!sea[first] || !sea[last]) return null;
  const workspace = searchWorkspaces.lease(sea);
  try {
    const previous = searchSeaCells(world, sea, first, last, workspace, clear, exhausted, clearGrid);
    if (!previous) return null;
    const result: SettlementPoint[] = [];
    for (let cell = last; cell !== first; cell = previous[cell]!)
      result.push({ x: cell % world.cellsX + 0.5, z: Math.floor(cell / world.cellsX) + 0.5 });
    result.reverse(); return result;
  } finally { workspace.release(); }
};
export interface CoastalWorkSite {
  land: SettlementPoint; water: SettlementPoint; path: SettlementPoint[]; yaw?: number;
}
interface ShoreCandidate { land: SettlementPoint; water: SettlementPoint; distance: number; yaw: number }
interface ShoreSearch {
  building: Pick<SettlementBuilding, "access">;
  clearance?: Uint8Array;
  held: SettlementPoint[];
  offsets: number[];
  radius: number;
  sea: Uint8Array;
}

const shoreSearch = (building: Pick<SettlementBuilding, "access">, sea: Uint8Array,
  reserved: ReadonlySet<string>, radius: number, clearance: Uint8Array | undefined,
  minimumOffset: number): ShoreSearch => ({
  building, clearance, radius, sea,
  held: [...reserved].map(key => { const [x, z] = key.split(",").map(Number); return { x: x!, z: z! }; }),
  offsets: clearance ? Array.from({ length: 22 }, (_, index) => index + 3)
    : Array.from({ length: 33 }, (_, index) => minimumOffset + index * .25)
});

/** Every open, unheld sea point straight off one dry land cell, reached over wet ground only. */
const collectShoreCandidates = (context: SettlementContext, search: ShoreSearch, x: number, z: number,
  candidates: ShoreCandidate[]) => {
  const { world } = context.options;
  const { building, clearance, held, offsets, radius, sea } = search;
  const land = { x: x + 0.5, z: z + 0.5 }, cell = z * world.cellsX + x;
  const distance = DMath.hypot(land.x - building.access.x, land.z - building.access.z);
  if (distance > radius || sea[cell] || !world.walkCost[cell] || context.occupied[cell] || world.blocking[cell]) return;
  for (const [dx, dz] of directions) for (const offset of offsets) {
    const water = { x: x + dx * offset + .5, z: z + dz * offset + .5 };
    if (water.x < 0 || water.z < 0 || water.x >= world.cellsX || water.z >= world.cellsZ) continue;
    if (!sea[Math.floor(water.z) * world.cellsX + Math.floor(water.x)] ||
      held.some(point => DMath.hypot(point.x - water.x, point.z - water.z) <
        SAILING_SHIP_TURN_RADIUS * 2 + SAILING_SHIP_SPACING)) continue;
    if (clearance && !clearance[Math.floor(water.z) * world.cellsX + Math.floor(water.x)]) continue;
    let shoreConnected = true;
    for (let step = 1; step < offset; step++) {
      if (sampleSmooth(world, world.heights, land.x + dx * step, land.z + dz * step) >
        world.seaLevel + .001) { shoreConnected = false; break; }
    }
    if (!shoreConnected) continue;
    candidates.push({ land, water, distance: clearance ? distance + offset * .001 : offset * 1000 + distance,
      yaw: DMath.atan2(dx, dz) + Math.PI / 2 });
  }
};

/** First candidate, nearest first, whose hull fits and whose short carrier route exists. */
const acceptShoreCandidate = (context: SettlementContext, search: ShoreSearch, candidates: ShoreCandidate[],
  accepts?: (site: CoastalWorkSite) => boolean): CoastalWorkSite | null => {
  const { world } = context.options;
  const { building, radius, sea } = search;
  candidates.sort((a, b) => a.distance - b.distance || a.land.z - b.land.z || a.land.x - b.land.x);
  for (const { land, water, yaw } of candidates) {
    if (!shipHullFitsSea(world, sea, { ...water, yaw })) continue;
    const path = coastalPath(context, building.access, land);
    if (!path) continue;
    let length = 0, previous = building.access;
    for (const point of path) { length += DMath.hypot(point.x - previous.x, point.z - previous.z); previous = point; }
    if (length > radius * 1.875 || sampleSmooth(world, world.heights, land.x, land.z) < world.seaLevel - 0.05)
      continue;
    const site = { land, water, path: path.map(point => ({ ...point })), yaw };
    if (!accepts || accepts(site)) return site;
  }
  return null;
};

/** Reachable land workpoint adjoining navigable sea, outside houses and roads' reserved entrances. */
export const findCoastalWorkSite = (context: SettlementContext, building: Pick<SettlementBuilding, "access">,
  sea: Uint8Array, reserved: ReadonlySet<string> = new Set(), radius = SHIPYARD_RADIUS,
  clearance?: Uint8Array, accepts?: (site: CoastalWorkSite) => boolean,
  minimumOffset = 2): CoastalWorkSite | null => {
  const { world } = context.options;
  refreshSeaMask(world, sea);
  const search = shoreSearch(building, sea, reserved, radius, clearance, minimumOffset);
  const candidates: ShoreCandidate[] = [];
  for (let z = Math.max(1, Math.floor(building.access.z - radius)); z < Math.min(world.cellsZ - 1, building.access.z + radius); z++)
    for (let x = Math.max(1, Math.floor(building.access.x - radius)); x < Math.min(world.cellsX - 1, building.access.x + radius); x++)
      collectShoreCandidates(context, search, x, z, candidates);
  return acceptShoreCandidate(context, search, candidates, accepts);
};

/**
 * HARBOUR-SPOTS: the same search restricted to one known shore cell (a stored harbour spot's
 * workpoint). Its candidates are a subset of the full search's, so a site found here is one the
 * full search accepts too; null only means "scan the whole coast instead".
 */
export const findCoastalWorkSiteAt = (context: SettlementContext, building: Pick<SettlementBuilding, "access">,
  sea: Uint8Array, land: SettlementPoint, radius = SHIPYARD_RADIUS, clearance?: Uint8Array,
  accepts?: (site: CoastalWorkSite) => boolean, minimumOffset = 2): CoastalWorkSite | null => {
  const { world } = context.options;
  const x = Math.floor(land.x), z = Math.floor(land.z);
  if (x < 1 || z < 1 || x >= world.cellsX - 1 || z >= world.cellsZ - 1) return null;
  refreshSeaMask(world, sea);
  const search = shoreSearch(building, sea, new Set(), radius, clearance, minimumOffset);
  const candidates: ShoreCandidate[] = [];
  collectShoreCandidates(context, search, x, z, candidates);
  return acceptShoreCandidate(context, search, candidates, accepts);
};
