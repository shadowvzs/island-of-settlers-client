import { DMath } from "../../../shared/math/deterministic-math";
import { sampleBilinear, sampleSmooth } from "../../../shared/world/grid-geometry";
import { createMountainField, getRockSkinCover } from "../../../shared/world/rock-cover";
import {
  BLOCKING,
  MATERIAL,
  MATERIAL_COUNT,
  type WorldData
} from "../../../shared/world/world-data";
import type { RockInstance } from "../../rocks/rock-instances";
import { SPECIES_IDS, SPECIES_PROFILES } from "../wildlife-species";
import { createForestDepth } from "./forest-depth";
import { createColliderSet } from "./nav-colliders";
import type { NavWorld } from "./nav-query";
import { createNavTerrain, getNavCell, type NavTerrain } from "./nav-terrain";
import { createSpeciesNav } from "./species-nav";
import { collectWorldColliders } from "./world-colliders";

/** Skin cover above which the ground counts as sculpted mountain rock (never walkable). */
const SKIN_COVER_LIMIT = 0.25;
/** Bare rock high in the mountains: mountain share and rock splat above these. */
const MOUNTAIN_SHARE_LIMIT = 0.35;
const MOUNTAIN_ROCK_SPLAT = 0.55;
const SLOPE_STEP = 0.25;

const getSurfaceSlope = (world: WorldData, x: number, z: number) => {
  const { heights } = world;
  const dx =
    sampleSmooth(world, heights, x + SLOPE_STEP, z) -
    sampleSmooth(world, heights, x - SLOPE_STEP, z);
  const dz =
    sampleSmooth(world, heights, x, z + SLOPE_STEP) -
    sampleSmooth(world, heights, x, z - SLOPE_STEP);
  return DMath.hypot(dx, dz) / (SLOPE_STEP * 2);
};

const getRockSplat = (world: WorldData, x: number, z: number) => {
  const vertex = Math.round(z) * (world.cellsX + 1) + Math.round(x);
  return (world.splat[vertex * MATERIAL_COUNT + MATERIAL.rock] ?? 0) / 255;
};

/**
 * Ground animals never use: gameplay cliff cells, the sculpted mountain rock skin (the same
 * cover formula as the render skin and prop placement) and bare rock high up the mountains.
 */
const createBlockedGround = (world: WorldData) => {
  const mountain = createMountainField(world, world.heights);
  return (x: number, z: number) => {
    const cell = Math.floor(z) * world.cellsX + Math.floor(x);
    if (world.blocking[cell] === BLOCKING.cliff) return true;
    const share = sampleBilinear(world, mountain, x, z);
    if (share <= 0) return false;
    if (getRockSkinCover(getSurfaceSlope(world, x, z), share) > SKIN_COVER_LIMIT) return true;
    return share > MOUNTAIN_SHARE_LIMIT && getRockSplat(world, x, z) > MOUNTAIN_ROCK_SPLAT;
  };
};

/** True when any of five points of the circle lies on ground the most agile species walks. */
const createGroundRockTest = (terrain: NavTerrain, maxSlope: number) => {
  const isWalkable = (x: number, z: number) => {
    const cell = getNavCell(terrain, x, z);
    return cell >= 0 && terrain.flags[cell] === 0 && terrain.slope[cell]! <= maxSlope;
  };
  return (x: number, z: number, radius: number) =>
    isWalkable(x, z) ||
    isWalkable(x + radius, z) ||
    isWalkable(x - radius, z) ||
    isWalkable(x, z + radius) ||
    isWalkable(x, z - radius);
};

/**
 * The animals' navigation layer of the island, built once: collision terrain from the smooth
 * surface, water and blocked ground, static colliders (trunks, shrubs, stones, rock layer), then
 * per species walkable masks and connected regions.
 */
export const createIslandNav = (world: WorldData, rocks: readonly RockInstance[]): NavWorld => {
  const terrain = createNavTerrain({
    cellsX: world.cellsX,
    cellsZ: world.cellsZ,
    height: (x, z) => sampleSmooth(world, world.heights, x, z),
    isBlockedGround: createBlockedGround(world),
    waterDepth: (x, z) => sampleBilinear(world, world.waterDepth, x, z)
  });
  const agile = Math.max(...SPECIES_PROFILES.map((profile) => profile.maxSlope));
  const colliders = createColliderSet(
    world.cellsX,
    world.cellsZ,
    collectWorldColliders(world, rocks, createGroundRockTest(terrain, agile))
  );
  const forestDepth = createForestDepth(terrain, colliders);
  const species = SPECIES_IDS.map((id) =>
    createSpeciesNav(terrain, colliders, SPECIES_PROFILES[id]!, id, forestDepth)
  );
  return { colliders, species, terrain };
};
