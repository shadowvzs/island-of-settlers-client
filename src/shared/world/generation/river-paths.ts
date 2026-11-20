import { getVertexCount, type GridSize,sampleBilinear } from "../grid-geometry";
import type { Random } from "../rng";
import { computeDistanceField } from "./distance-field";
import { fillDepressions, NEIGHBOURS } from "./hydrology";
import { createRiverCourse, type RiverCourse } from "./river-course";
import { findRiverSources } from "./river-sources";
import { floodSea } from "./water";

const MIN_RIVER_LENGTH = 28;
const RIVER_SPACING = 6;

/** Steepest descent on the filled surface from a source vertex down to the first sea vertex. */
const traceRiver = (
  grid: GridSize,
  filled: Float32Array,
  sea: Uint8Array,
  source: number
) => {
  const stride = grid.cellsX + 1;
  const path = [source];
  let current = source;
  const maxSteps = grid.cellsX * grid.cellsZ;
  while (!sea[current] && path.length < maxSteps) {
    const x = current % stride;
    const z = Math.floor(current / stride);
    let next = -1;
    let lowest = filled[current]!;
    for (const [dx, dz] of NEIGHBOURS) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx > grid.cellsX || nz > grid.cellsZ) continue;
      const neighbour = nz * stride + nx;
      if (filled[neighbour]! < lowest) {
        lowest = filled[neighbour]!;
        next = neighbour;
      }
    }
    if (next < 0) break;
    path.push(next);
    current = next;
  }
  return path;
};

const isNearAnyRiver = (grid: GridSize, taken: Uint8Array, path: number[]) => {
  const stride = grid.cellsX + 1;
  return path.some((index) => {
    const x = index % stride;
    const z = Math.floor(index / stride);
    for (let dz = -RIVER_SPACING; dz <= RIVER_SPACING; dz += 2) {
      for (let dx = -RIVER_SPACING; dx <= RIVER_SPACING; dx += 2) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx > grid.cellsX || nz > grid.cellsZ) continue;
        if (taken[nz * stride + nx]) return true;
      }
    }
    return false;
  });
};

/** Area a river must not touch, e.g. the start settlement. */
interface KeepOut {
  radius: number;
  x: number;
  z: number;
}

export interface RiverRequest {
  /** Extra ground no river may touch (e.g. the reserved island plots); absent on ordinary maps. */
  avoid?: (x: number, z: number) => boolean;
  count: number;
  keepOut: KeepOut;
  /** Shortest accepted river (vertices); small planned islands accept shorter upland streams. */
  minLength?: number;
}

/** Rivers keep this far (cells) from the map border: none runs along a peninsula's cut edge. */
const BORDER_MARGIN = 4;
/** Meanders keep the channel this far (cells) from the sea before the mouth. */
const SEA_CLEARANCE = 1.5;
/** Meanders keep this far (cells) from the half way line to another river. */
const RIVER_CLEARANCE = 1.5;
/** Safety margin (cells) on every meander room. */
const ROOM_MARGIN = 0.5;

const isInKeepOut = (grid: GridSize, index: number, { avoid, keepOut }: RiverRequest) => {
  const stride = grid.cellsX + 1;
  const x = index % stride;
  const z = Math.floor(index / stride);
  if (Math.min(x, z, grid.cellsX - x, grid.cellsZ - z) < BORDER_MARGIN) return true;
  if (Math.hypot(x - keepOut.x, z - keepOut.z) < keepOut.radius) return true;
  return avoid?.(x, z) ?? false;
};

/**
 * Up to `count` independent vertex paths from mountain springs (river-sources.ts); each long enough, apart, off
 * the map border and out of the keep-out area.
 */
const findRiverPaths = (
  grid: GridSize,
  heights: Float32Array,
  seaLevel: number,
  filled: Float32Array,
  sea: Uint8Array,
  river: RiverRequest,
  random: Random
) => {
  const { count, minLength = MIN_RIVER_LENGTH } = river;
  const sources = findRiverSources(grid, heights, seaLevel, random);
  const taken = new Uint8Array(getVertexCount(grid));
  const paths: number[][] = [];
  for (const source of sources) {
    if (paths.length >= count) break;
    const path = traceRiver(grid, filled, sea, source);
    if (path.length < minLength || isNearAnyRiver(grid, taken, path)) continue;
    if (path.some((index) => isInKeepOut(grid, index, river))) continue;
    for (const index of path) taken[index] = 1;
    paths.push(path);
  }
  return paths;
};

/** Distance (cells) to the other rivers' paths, per vertex. */
const getOtherRiversDistance = (grid: GridSize, paths: number[][], own: number) => {
  const others = new Uint8Array(getVertexCount(grid));
  paths.forEach((path, index) => {
    if (index === own) return;
    for (const vertex of path) others[vertex] = 1;
  });
  return computeDistanceField(grid, (index) => others[index] === 1);
};

/** Sideways room (cells) for the meanders: off the border, the start, the sea, other rivers. */
const createMeanderRoom =
  (grid: GridSize, keepOut: KeepOut, seaDistance: Float32Array, otherRivers: Float32Array) =>
  (x: number, z: number) =>
    Math.min(
      Math.min(x, z, grid.cellsX - x, grid.cellsZ - z) - BORDER_MARGIN,
      Math.hypot(x - keepOut.x, z - keepOut.z) - keepOut.radius,
      sampleBilinear(grid, seaDistance, x, z) - SEA_CLEARANCE,
      sampleBilinear(grid, otherRivers, x, z) / 2 - RIVER_CLEARANCE
    ) - ROOM_MARGIN;

/**
 * Up to `count` river courses: traced from high sources down to the open sea, then shaped
 * into natural meandering centrelines (river-course.ts) that open into the sea.
 */
export const findRiverCourses = (
  grid: GridSize,
  heights: Float32Array,
  seaLevel: number,
  river: RiverRequest,
  random: Random
): RiverCourse[] => {
  const sea = floodSea(grid, heights, seaLevel);
  const filled = fillDepressions(grid, heights, sea);
  const paths = findRiverPaths(grid, heights, seaLevel, filled, sea, river, random);
  const seaDistance = computeDistanceField(grid, (index) => sea[index] === 1);
  return paths.map((path, index) => {
    const otherRivers = getOtherRiversDistance(grid, paths, index);
    const room = createMeanderRoom(grid, river.keepOut, seaDistance, otherRivers);
    return createRiverCourse(grid, path, { heights, room }, random);
  });
};
