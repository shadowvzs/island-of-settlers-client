import type { SpeciesProfile } from "../wildlife-species";
import type { ColliderSet } from "./nav-colliders";
import { NAV_CELL, NAV_RES, type NavTerrain } from "./nav-terrain";

/** A rise steeper than this is a drop (cliff lip): species with a cliff margin keep away. */
const DROP_SLOPE = 1;
/** Share of the clearance used when rasterising colliders (the exact test is the authority). */
const RASTER_CLEARANCE = 0.85;
export const NO_REGION = -1;

/**
 * Walkability of one species: `ground` is the terrain mask (slope limit, water, rock, cliff
 * margin), `open` also leaves out the cells colliders crowd for this body size (pathfinding and
 * regions), `region` labels the connected open areas (reachability).
 */
export interface SpeciesNav {
  /** Body capsule: rump and nose reach from the centre along the heading. */
  back: number;
  bit: number;
  /** Capsule radius (half width plus margin). */
  clearance: number;
  front: number;
  ground: Uint8Array;
  maxSlope: number;
  open: Uint8Array;
  region: Int32Array;
  /** Area (world units squared) of each region id. */
  regionArea: Float32Array;
  /** Room to stand and turn on the spot. */
  standRadius: number;
}

/** Clears every cell within `margin` nav cells of a drop (cliff lips, water is excluded). */
const applyCliffMargin = (terrain: NavTerrain, ground: Uint8Array, margin: number) => {
  if (margin <= 0) return;
  const { depth, width } = terrain;
  const near = new Uint8Array(width * depth);
  for (let row = 0; row < depth; row += 1) {
    for (let column = 0; column < width; column += 1) {
      if (terrain.slope[row * width + column]! <= DROP_SLOPE) continue;
      for (let dz = -margin; dz <= margin; dz += 1) {
        for (let dx = -margin; dx <= margin; dx += 1) {
          const x = column + dx;
          const z = row + dz;
          if (x >= 0 && z >= 0 && x < width && z < depth) near[z * width + x] = 1;
        }
      }
    }
  }
  for (let cell = 0; cell < ground.length; cell += 1) if (near[cell]) ground[cell] = 0;
};

/**
 * Terrain mask of a species: slope, water, rock, cliff margin, and its forest depth limit (elk
 * only enter a forest's margin, the core is not walkable ground for them).
 */
const createGroundMask = (
  terrain: NavTerrain,
  profile: SpeciesProfile,
  forestDepth: Float32Array
) => {
  const ground = new Uint8Array(terrain.width * terrain.depth);
  for (let cell = 0; cell < ground.length; cell += 1) {
    if (forestDepth[cell]! > profile.maxForestDepth) continue;
    ground[cell] = terrain.flags[cell] === 0 && terrain.slope[cell]! <= profile.maxSlope ? 1 : 0;
  }
  applyCliffMargin(terrain, ground, profile.cliffMargin);
  return ground;
};

/** Ground mask minus the cells whose centre a collider grown by the standing room covers. */
const rasterizeColliders = (
  terrain: NavTerrain,
  ground: Uint8Array,
  colliders: ColliderSet,
  bit: number,
  clearance: number
) => {
  const open = ground.slice();
  for (let index = 0; index < colliders.count; index += 1) {
    if ((colliders.mask[index]! & bit) === 0) continue;
    const reach = colliders.radius[index]! + clearance * RASTER_CLEARANCE;
    const x = colliders.x[index]!;
    const z = colliders.z[index]!;
    const firstColumn = Math.max(0, Math.floor((x - reach) * NAV_RES));
    const lastColumn = Math.min(terrain.width - 1, Math.floor((x + reach) * NAV_RES));
    const firstRow = Math.max(0, Math.floor((z - reach) * NAV_RES));
    const lastRow = Math.min(terrain.depth - 1, Math.floor((z + reach) * NAV_RES));
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const dx = (column + 0.5) * NAV_CELL - x;
        const dz = (row + 0.5) * NAV_CELL - z;
        if (dx * dx + dz * dz < reach * reach) open[row * terrain.width + column] = 0;
      }
    }
  }
  return open;
};

/** Flood fill labels of the 4-connected open areas, and the area of each. */
export const labelRegions = (open: Uint8Array, width: number, depth: number) => {
  const region = new Int32Array(width * depth).fill(NO_REGION);
  const queue = new Int32Array(width * depth);
  const areas: number[] = [];
  for (let start = 0; start < open.length; start += 1) {
    if (!open[start] || region[start] !== NO_REGION) continue;
    const id = areas.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    region[start] = id;
    while (head < tail) {
      const cell = queue[head++]!;
      const column = cell % width;
      const neighbours = [
        column > 0 ? cell - 1 : -1,
        column < width - 1 ? cell + 1 : -1,
        cell - width,
        cell + width
      ];
      for (const next of neighbours) {
        if (next < 0 || next >= open.length || !open[next] || region[next] !== NO_REGION) continue;
        region[next] = id;
        queue[tail++] = next;
      }
    }
    areas.push(tail * NAV_CELL * NAV_CELL);
  }
  return { region, regionArea: Float32Array.from(areas) };
};

export const createSpeciesNav = (
  terrain: NavTerrain,
  colliders: ColliderSet,
  profile: SpeciesProfile,
  species: number,
  forestDepth: Float32Array
): SpeciesNav => {
  const bit = 1 << species;
  const ground = createGroundMask(terrain, profile, forestDepth);
  const open = rasterizeColliders(terrain, ground, colliders, bit, profile.standRadius);
  return {
    back: profile.body.back,
    bit,
    clearance: profile.clearance,
    front: profile.body.front,
    ground,
    maxSlope: profile.maxSlope,
    open,
    ...labelRegions(open, terrain.width, terrain.depth),
    standRadius: profile.standRadius
  };
};
