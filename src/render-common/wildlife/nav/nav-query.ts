import { DMath } from "../../../shared/math/deterministic-math";
import { type ColliderSet,isCircleBlocked, isSegmentBlocked } from "./nav-colliders";
import { getNavCell, NAV_CELL, NAV_RES, type NavTerrain,sampleNavHeight } from "./nav-terrain";
import { NO_REGION, type SpeciesNav } from "./species-nav";

/** Everything the animals know about the ground: terrain lattice, colliders, species masks. */
export interface NavWorld {
  colliders: ColliderSet;
  species: SpeciesNav[];
  terrain: NavTerrain;
  /** Live reserved areas, such as construction plots; leaves the generated terrain unchanged. */
  isExcluded?: (x: number, z: number, margin?: number) => boolean;
}

/** Samples along a movement segment: a quarter world unit (two per nav cell). */
const SEGMENT_STEP = NAV_CELL / 2;
/**
 * Rise allowed between two samples relative to the species slope limit: the mask judges whole
 * cells, this catches a cliff lip crossed between two walkable cells.
 */
const EDGE_RISE_FACTOR = 1.35;

/** Terrain only: slope, water, rock, cliff margin of the species. */
export const isGroundWalkable = (nav: NavWorld, species: number, x: number, z: number) => {
  if (nav.isExcluded?.(x, z)) return false;
  const cell = getNavCell(nav.terrain, x, z);
  return cell >= 0 && nav.species[species]!.ground[cell] === 1;
};

/**
 * Room to stand and turn on the spot: walkable ground and no trunk, crown, rock or shrub
 * within the species' standing radius (spawns, wander and escape targets).
 */
export const isStandFree = (nav: NavWorld, species: number, x: number, z: number) => {
  if (!isGroundWalkable(nav, species, x, z)) return false;
  const { bit, standRadius } = nav.species[species]!;
  if (nav.isExcluded?.(x, z, standRadius)) return false;
  return !isCircleBlocked(nav.colliders, bit, x, z, standRadius);
};

/**
 * The whole body fits at (x, z) facing `heading`: rump, centre and nose on walkable ground and
 * the body capsule (rump to nose, half width plus margin) clear of every collider. `size`
 * scales the capsule with age (a juvenile never uses the adult capsule).
 */
export const isBodyFree = (
  nav: NavWorld,
  species: number,
  x: number,
  z: number,
  heading: number,
  size = 1
) => {
  const speciesNav = nav.species[species]!;
  const back = speciesNav.back * size;
  const front = speciesNav.front * size;
  const clearance = speciesNav.clearance * size;
  const { bit } = speciesNav;
  const cos = DMath.cos(heading);
  const sin = DMath.sin(heading);
  const noseX = x + cos * front;
  const noseZ = z + sin * front;
  const rumpX = x - cos * back;
  const rumpZ = z - sin * back;
  if (nav.isExcluded?.(x, z, clearance) || nav.isExcluded?.(noseX, noseZ, clearance) ||
    nav.isExcluded?.(rumpX, rumpZ, clearance)) return false;
  if (!isGroundWalkable(nav, species, x, z)) return false;
  if (!isGroundWalkable(nav, species, noseX, noseZ)) return false;
  if (!isGroundWalkable(nav, species, rumpX, rumpZ)) return false;
  return !isSegmentBlocked(nav.colliders, bit, rumpX, rumpZ, noseX, noseZ, clearance);
};

/** Terrain along the segment: every sample walkable and no cliff sized rise between samples. */
const isSegmentGroundWalkable = (
  nav: NavWorld,
  species: number,
  x0: number,
  z0: number,
  x1: number,
  z1: number
) => {
  const length = DMath.hypot(x1 - x0, z1 - z0);
  const steps = Math.max(1, Math.ceil(length / SEGMENT_STEP));
  const step = length / steps;
  const riseLimit = nav.species[species]!.maxSlope * EDGE_RISE_FACTOR * Math.max(step, 0.05);
  let previous = sampleNavHeight(nav.terrain, x0, z0);
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t;
    if (!isGroundWalkable(nav, species, x, z)) return false;
    const height = sampleNavHeight(nav.terrain, x, z);
    if (Math.abs(height - previous) > riseLimit) return false;
    previous = height;
  }
  return true;
};

/**
 * Movement validation: the body walking along the segment (facing along it) sweeps a capsule
 * from its rump at the start to its nose at the end. That stays on walkable ground of the
 * species, crosses no cliff edge or water, and keeps clear of every trunk, crown, rock and
 * blocking shrub.
 */
export const isSegmentWalkable = (
  nav: NavWorld,
  species: number,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  size = 1
) => {
  const length = DMath.hypot(x1 - x0, z1 - z0);
  if (length < 1e-4) return isStandFree(nav, species, x0, z0);
  const speciesNav = nav.species[species]!;
  const back = speciesNav.back * size;
  const front = speciesNav.front * size;
  const clearance = speciesNav.clearance * size;
  const { bit } = speciesNav;
  const dx = (x1 - x0) / length;
  const dz = (z1 - z0) / length;
  const noseX = x1 + dx * front;
  const noseZ = z1 + dz * front;
  if (nav.isExcluded) {
    const steps = Math.max(1, Math.ceil((length + back + front) / SEGMENT_STEP));
    for (let step = 0; step <= steps; step++) {
      const distance = -back + (length + back + front) * step / steps;
      if (nav.isExcluded(x0 + dx * distance, z0 + dz * distance, clearance)) return false;
    }
  }
  if (!isSegmentGroundWalkable(nav, species, x0, z0, noseX, noseZ)) return false;
  return !isSegmentBlocked(
    nav.colliders,
    bit,
    x0 - dx * back,
    z0 - dz * back,
    noseX,
    noseZ,
    clearance
  );
};

/** Connected area id at a point, looking one nav cell around (a body brushing an obstacle). */
const getRegionNear = (nav: NavWorld, species: number, x: number, z: number) => {
  const { region } = nav.species[species]!;
  const { depth, width } = nav.terrain;
  const column = Math.floor(x * NAV_RES);
  const row = Math.floor(z * NAV_RES);
  for (let ring = 0; ring <= 1; ring += 1) {
    for (let dz = -ring; dz <= ring; dz += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        const c = column + dx;
        const r = row + dz;
        if (c < 0 || r < 0 || c >= width || r >= depth) continue;
        const id = region[r * width + c]!;
        if (id !== NO_REGION) return id;
      }
    }
  }
  return NO_REGION;
};

/** Both points lie in the same connected walkable area of the species. */
export const isReachable = (
  nav: NavWorld,
  species: number,
  x0: number,
  z0: number,
  x1: number,
  z1: number
) => {
  const from = getRegionNear(nav, species, x0, z0);
  return from !== NO_REGION && from === getRegionNear(nav, species, x1, z1);
};

/** Area (world units squared) of the connected region at a point, 0 outside any. */
export const getRegionArea = (nav: NavWorld, species: number, x: number, z: number) => {
  const id = getRegionNear(nav, species, x, z);
  return id === NO_REGION ? 0 : nav.species[species]!.regionArea[id]!;
};

/** Steepest rise a bedded animal accepts (flatter than walking). */
const REST_SLOPE = DMath.tan((16 * Math.PI) / 180);
/** Extra room around a bedded body (head, folded legs, antlers swing when it rises). */
const REST_MARGIN = 1.25;

/** No unwalkable nav cell (cliff lip, water, map border, steep drop) within one cell around. */
const isAwayFromEdges = (nav: NavWorld, species: number, x: number, z: number) => {
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (!isGroundWalkable(nav, species, x + dx * NAV_CELL, z + dz * NAV_CELL)) return false;
    }
  }
  return true;
};

/**
 * A spot to lie down: walkable and well inside the walkable area (no cliff edge, water or nav
 * boundary next to it), gently sloped, and the body with some extra room clear of trunks,
 * low crowns (antlers), rocks and shrubs.
 */
export const isRestSpotValid = (
  nav: NavWorld,
  species: number,
  x: number,
  z: number,
  heading: number,
  size = 1
) => {
  const cell = getNavCell(nav.terrain, x, z);
  if (cell < 0 || nav.terrain.slope[cell]! > REST_SLOPE) return false;
  if (!isAwayFromEdges(nav, species, x, z)) return false;
  return isBodyFree(nav, species, x, z, heading, size * REST_MARGIN);
};
