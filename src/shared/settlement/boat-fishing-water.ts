import { FISHING_SKIFF_BEAM, FISHING_SKIFF_KEEL_DEPTH, FISHING_SKIFF_LENGTH, FISHING_SKIFF_ROW_CLEARANCE } from "../../render-common/ships/fishing-skiff-dimensions";
import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { BLOCKING, type WorldData } from "../world/world-data";
import {
  BOAT_FOUR_NEIGHBOURS, BOAT_LAKE_MIN_CLEAR_CELLS, BOAT_MASK_RADIUS, BOAT_RIVER_DISTANCE_MIN, BOAT_RIVER_FLOW_MIN,
  BOAT_WATERLINE_REACH, BOAT_WATERLINE_STEP
} from "./constants";

/** Boat water kinds a Fishery may row on; rivers, estuaries and ponds are never boat water. */
export type BoatWaterKind = "lake" | "sea";

/**
 * Per-cell boat water of one terrain revision (FISHER-BOAT §1.2): connected components of non-river
 * water (4-neighbour), their kind, and the skiff-clear mask (every cell within the hull/oar
 * radius is boat water of the same component).
 */
export interface BoatWaterClasses {
  /** Component per cell, -1 for dry, river or out-of-component cells. */
  component: Int32Array;
  /** Kind per component; undefined for a pond (too small for a skiff). */
  kinds: (BoatWaterKind | undefined)[];
  /** 1 where a rowing skiff fits (hull plus oars). */
  clear: Uint8Array;
}

const cache = new WeakMap<WorldData, { revision: number; classes: BoatWaterClasses }>();

const vertexFlows = (world: WorldData, vertex: number) => {
  const flow = world.flow;
  if (!flow) return false;
  return DMath.hypot(flow[vertex * 2] ?? 0, flow[vertex * 2 + 1] ?? 0) > BOAT_RIVER_FLOW_MIN;
};

const vertexNearRiver = (world: WorldData, vertex: number) =>
  (world.riverDistance?.[vertex] ?? Infinity) < BOAT_RIVER_DISTANCE_MIN;

/** A river cell: running water or a river bed within reach at any of its four corners. */
const isRiverCell = (world: WorldData, x: number, z: number) => {
  const stride = world.cellsX + 1, top = z * stride + x;
  for (const vertex of [top, top + 1, top + stride, top + stride + 1])
    if (vertexFlows(world, vertex) || vertexNearRiver(world, vertex)) return true;
  return false;
};

const boatWaterCells = (world: WorldData) => {
  const water = new Uint8Array(world.cellsX * world.cellsZ);
  for (let z = 0; z < world.cellsZ; z++) for (let x = 0; x < world.cellsX; x++) {
    const cell = z * world.cellsX + x;
    if (world.blocking[cell] === BLOCKING.water && !isRiverCell(world, x, z)) water[cell] = 1;
  }
  return water;
};

const isBorderCell = (world: WorldData, x: number, z: number) =>
  x === 0 || z === 0 || x === world.cellsX - 1 || z === world.cellsZ - 1;

/** Flood fills one component from `first`; returns whether it touches the map border. */
const fillComponent = (
  world: WorldData, water: Uint8Array, component: Int32Array, first: number, id: number
) => {
  const queue = [first];
  let border = false;
  component[first] = id;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const cell = queue[cursor]!, x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
    border ||= isBorderCell(world, x, z);
    for (const [dx, dz] of BOAT_FOUR_NEIGHBOURS) {
      const nx = x + dx, nz = z + dz, next = nz * world.cellsX + nx;
      if (nx < 0 || nz < 0 || nx >= world.cellsX || nz >= world.cellsZ) continue;
      if (!water[next] || component[next] !== -1) continue;
      component[next] = id;
      queue.push(next);
    }
  }
  return border;
};

const isSkiffClear = (world: WorldData, component: Int32Array, x: number, z: number) => {
  const own = component[z * world.cellsX + x]!;
  if (own < 0) return false;
  for (let dz = -BOAT_MASK_RADIUS; dz <= BOAT_MASK_RADIUS; dz++)
    for (let dx = -BOAT_MASK_RADIUS; dx <= BOAT_MASK_RADIUS; dx++) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= world.cellsX || nz >= world.cellsZ) return false;
      if (component[nz * world.cellsX + nx] !== own) return false;
    }
  return isSkiffWaterClear(world, x + .5, z + .5);
};

/** Check the visible terrain, not only a cell's water flag, under the turning hull and oars. */
export const isSkiffWaterClear = (world: WorldData, x: number, z: number, hullHeading?: number) => {
  const radius = Math.max(FISHING_SKIFF_LENGTH / 2, FISHING_SKIFF_ROW_CLEARANCE);
  const sin = hullHeading === undefined ? 0 : DMath.sin(hullHeading);
  const cos = hullHeading === undefined ? 1 : DMath.cos(hullHeading);
  for (let iz = -2; iz <= 2; iz++) for (let ix = -2; ix <= 2; ix++) {
    const side = (hullHeading === undefined ? radius : FISHING_SKIFF_BEAM / 2) * ix / 2;
    const along = (hullHeading === undefined ? radius : FISHING_SKIFF_LENGTH / 2) * iz / 2;
    const px = x + side * cos + along * sin, pz = z - side * sin + along * cos;
    if (px < 0 || pz < 0 || px >= world.cellsX || pz >= world.cellsZ) return false;
    if (boatWaterSurface(world, px, pz) - sampleSmooth(world, world.heights, px, pz) < FISHING_SKIFF_KEEL_DEPTH + .02)
      return false;
  }
  return true;
};

const buildClasses = (world: WorldData): BoatWaterClasses => {
  const water = boatWaterCells(world);
  const component = new Int32Array(water.length).fill(-1);
  const borders: boolean[] = [];
  for (let cell = 0; cell < water.length; cell++) {
    if (!water[cell] || component[cell] !== -1) continue;
    borders.push(fillComponent(world, water, component, cell, borders.length));
  }
  const clear = new Uint8Array(water.length), clearCounts = new Array<number>(borders.length).fill(0);
  for (let z = 0; z < world.cellsZ; z++) for (let x = 0; x < world.cellsX; x++) {
    if (!isSkiffClear(world, component, x, z)) continue;
    const cell = z * world.cellsX + x;
    clear[cell] = 1;
    clearCounts[component[cell]!]!++;
  }
  const kinds = borders.map((border, id): BoatWaterKind | undefined => {
    if (border && clearCounts[id]! > 0) return "sea";
    return clearCounts[id]! >= BOAT_LAKE_MIN_CLEAR_CELLS ? "lake" : undefined;
  });
  return { clear, component, kinds };
};

/** Cached per world and terrain revision; deterministic integer flood fills only. */
export const classifyBoatWater = (world: WorldData): BoatWaterClasses => {
  const revision = world.terrainRevision ?? 0, cached = cache.get(world);
  if (cached?.revision === revision) return cached.classes;
  const classes = buildClasses(world);
  cache.set(world, { classes, revision });
  return classes;
};

/** The boat water kind of a cell, or undefined for land, rivers and ponds. */
export const boatWaterKindAt = (world: WorldData, classes: BoatWaterClasses, x: number, z: number) => {
  if (x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ) return undefined;
  const id = classes.component[Math.floor(z) * world.cellsX + Math.floor(x)]!;
  return id < 0 ? undefined : classes.kinds[id];
};

/** Visible water surface at a point (lakes keep their own surface). */
export const boatWaterSurface = (world: WorldData, x: number, z: number) => {
  const surface = world.waterSurface ? sampleSmooth(world, world.waterSurface, x, z) : NaN;
  return Number.isFinite(surface) ? surface : world.seaLevel;
};

/** Water depth at a point: the depth layer when present, else surface minus ground. */
export const boatWaterDepth = (world: WorldData, x: number, z: number) => {
  if (world.waterDepth) {
    const depth = sampleSmooth(world, world.waterDepth, x, z);
    if (Number.isFinite(depth)) return depth;
  }
  return boatWaterSurface(world, x, z) - sampleSmooth(world, world.heights, x, z);
};

/**
 * The visible waterline seen from a point on the sand: the first point along (directionX, directionZ)
 * whose ground is at or below `surface`. Null when it lies beyond the reach (a steep or dry bank).
 */
export const boatWaterlineAlong = (
  world: WorldData, from: { x: number; z: number }, directionX: number, directionZ: number, surface: number
) => {
  const steps = Math.round(BOAT_WATERLINE_REACH / BOAT_WATERLINE_STEP);
  for (let index = 0; index <= steps; index++) {
    const reach = index * BOAT_WATERLINE_STEP;
    const x = from.x + directionX * reach, z = from.z + directionZ * reach;
    if (sampleSmooth(world, world.heights, x, z) <= surface) return { x, z };
  }
  return null;
};
