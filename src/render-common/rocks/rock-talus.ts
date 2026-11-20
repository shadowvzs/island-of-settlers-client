import { createFbm, type Noise2,smoothstep } from "../../shared/world/noise";
import { deriveSeed } from "../../shared/world/rng";
import { type GeologyMap,isOnFracture } from "./geology";
import { ROCK_FAMILY, type RockFamily } from "./rock-shapes";
import { getSkinWeight } from "./rock-skin";
import { getGradient, type RockTerrain } from "./rock-terrain";
import { createGullyNoise, getGullyShare } from "./skin-relief";

/**
 * Talus at the mountain foot (brief: base of cliff): fallen rock collects below tall steep faces,
 * most of it under the gullies, fracture lines and recesses of the wall and in a few rockfall
 * cones elsewhere; little or none below short or gentle rock. Every spot knows how much talus
 * it gets and where it lies in its fan (at the wall .. at the runout), so the stone sizes can be
 * graded. The foot comes from the skin edge (bare ground with solid rock skin rising uphill), so
 * it follows whatever landform the heights produce.
 */
export interface TalusSpot {
  /** 0 none .. 1 a full talus fan. */
  amount: number;
  /** 0 at the wall .. 1 at the fan's runout. */
  run: number;
}

const NO_TALUS: TalusSpot = { amount: 0, run: 1 };

/** No talus in the snow band (scree there lies buried under the snow cap). */
const SNOW_HEIGHT = 6.8;
/** Talus only lies on ground flatter than this (never perched on the face). */
export const TALUS_MAX_SLOPE = 0.8;
/** The wall foot found uphill lies at least this much above the spot (no lower rock). */
const MIN_WALL_RISE = 0.15;
/** Uphill probe distances (cells) looking for the rock wall above a spot. */
const WALL_PROBES = [0.6, 1.2, 1.9, 2.7, 3.6, 4.6, 5.6, 6.6];
/** Distances (cells) beyond the wall foot that measure how tall the wall is. */
const HEIGHT_PROBES = [1.5, 3, 5];
/** Wall height (world units) from which talus starts and where the supply is full. */
const WALL_HEIGHT: [number, number] = [1, 5];
/** Fan runout: base reach (cells) plus this share of the wall height, capped. */
const RUNOUT = { base: 1.2, perHeight: 0.9, max: 6.5 } as const;
/** Some talus below every tall wall, the rest from its chutes and rockfall cones. */
const BASE_SUPPLY = 0.15;
const CONE_SHARE = 0.75;
/** Field resolution (cells): a lazily filled grid, so scree and boulders share one evaluation. */
const RESOLUTION = 0.5;

/** The wall above a foot spot: its distance (cells) and the uphill direction, or null. */
const findWall = (terrain: RockTerrain, x: number, z: number) => {
  const [gx, gz] = getGradient(terrain, x, z);
  const slope = Math.hypot(gx, gz);
  if (slope < 0.05 || slope > TALUS_MAX_SLOPE) return null;
  const here = terrain.height(x, z);
  const dirX = gx / slope;
  const dirZ = gz / slope;
  for (const distance of WALL_PROBES) {
    const probeX = x + dirX * distance;
    const probeZ = z + dirZ * distance;
    if (terrain.height(probeX, probeZ) - here <= MIN_WALL_RISE) continue;
    if (getSkinWeight(terrain, probeX, probeZ) > 0.6) return { dirX, dirZ, distance, here };
  }
  return null;
};

type Wall = NonNullable<ReturnType<typeof findWall>>;

/** How far the wall rises above the spot (world units). */
const measureWallHeight = (terrain: RockTerrain, x: number, z: number, wall: Wall) =>
  Math.max(
    ...HEIGHT_PROBES.map((beyond) => {
      const reach = wall.distance + beyond;
      return terrain.height(x + wall.dirX * reach, z + wall.dirZ * reach) - wall.here;
    })
  );

interface TalusSources {
  cones: Noise2;
  geology: GeologyMap;
  gullies: Noise2;
}

/**
 * 0 .. 1 chute above the spot: a gully or a fracture line in the wall, or a recess (the wall
 * line bends back); looked up across the fan's width, so the talus spreads into a cone below it.
 */
const getChute = (
  sources: TalusSources,
  terrain: RockTerrain,
  x: number,
  z: number,
  wall: Wall
) => {
  const wallX = x + wall.dirX * wall.distance;
  const wallZ = z + wall.dirZ * wall.distance;
  const spread = 0.5 + wall.distance * 0.45;
  const sideX = -wall.dirZ * spread;
  const sideZ = wall.dirX * spread;
  const gully = Math.max(
    getGullyShare(sources.gullies, wallX, wallZ),
    getGullyShare(sources.gullies, wallX + sideX, wallZ + sideZ),
    getGullyShare(sources.gullies, wallX - sideX, wallZ - sideZ)
  );
  if (gully >= 1 || isOnFracture(sources.geology, wallX, wallZ)) return 1;
  const sides =
    (terrain.height(wallX + sideX * 2, wallZ + sideZ * 2) +
      terrain.height(wallX - sideX * 2, wallZ - sideZ * 2)) /
    2;
  const recess = smoothstep(0.2, 0.9, sides - terrain.height(wallX, wallZ));
  return Math.max(gully, recess);
};

/** Talus at a point (uncached): the supply of the wall above and the place in its fan. */
const sampleTalus = (
  sources: TalusSources,
  terrain: RockTerrain,
  x: number,
  z: number
): TalusSpot => {
  if (terrain.height(x, z) > SNOW_HEIGHT) return NO_TALUS;
  const local = getSkinWeight(terrain, x, z);
  if (local > 0.7) return NO_TALUS;
  const wall = findWall(terrain, x, z);
  if (!wall) return NO_TALUS;
  const height = measureWallHeight(terrain, x, z, wall);
  const tall = smoothstep(WALL_HEIGHT[0], WALL_HEIGHT[1], height);
  if (tall <= 0) return NO_TALUS;
  const runout = Math.min(RUNOUT.max, RUNOUT.base + height * RUNOUT.perHeight);
  const run = wall.distance / runout;
  if (run > 1) return NO_TALUS;
  const cone = smoothstep(0.1, 0.55, sources.cones(x * 0.11, z * 0.11)) * CONE_SHARE;
  const chute = getChute(sources, terrain, x, z, wall);
  const supply = Math.min(1, BASE_SUPPLY + Math.max(chute, cone));
  return { amount: tall * supply * (1 - local * 0.8), run };
};

export type TalusField = (x: number, z: number) => TalusSpot;

/**
 * The talus field of a terrain (deterministic per seed and heights): evaluated lazily on a
 * RESOLUTION grid, each spot reads its nearest grid point.
 */
export const createTalusField = (
  terrain: RockTerrain,
  geology: GeologyMap,
  seed: number
): TalusField => {
  const sources: TalusSources = {
    cones: createFbm(deriveSeed(seed, "talus-cones"), { octaves: 2 }),
    geology,
    gullies: createGullyNoise(seed)
  };
  const columns = Math.ceil(terrain.cellsX / RESOLUTION) + 1;
  const rows = Math.ceil(terrain.cellsZ / RESOLUTION) + 1;
  const known: (TalusSpot | undefined)[] = new Array(columns * rows);
  return (x, z) => {
    const column = Math.min(columns - 1, Math.max(0, Math.round(x / RESOLUTION)));
    const row = Math.min(rows - 1, Math.max(0, Math.round(z / RESOLUTION)));
    const index = row * columns + column;
    const cached = known[index];
    if (cached) return cached;
    const spot = sampleTalus(sources, terrain, column * RESOLUTION, row * RESOLUTION);
    known[index] = spot;
    return spot;
  };
};

/** Fallen rock shows fresh broken faces: cleaner than the weathered foot of the wall. */
export const TALUS_EXPOSURE = 0.6;

/** Talus stone families: angular blocks, slabs and broken pieces (no round boulders). */
const TALUS_FAMILIES: readonly RockFamily[] = [
  ROCK_FAMILY.blocky,
  ROCK_FAMILY.broken,
  ROCK_FAMILY.slab
];

/** Picks the stone family of a talus spot (`roll` 0..1 a random draw). */
export type TalusFamilyPicker = (x: number, z: number, roll: number) => RockFamily;

/**
 * The stone family of a talus spot: one per fan region (neighbours alike, so the foot never
 * reads as a heap of mixed pieces), a few strays of the next family.
 */
export const createTalusFamilies = (seed: number): TalusFamilyPicker => {
  const regions = createFbm(deriveSeed(seed, "talus-families"), { octaves: 2 });
  return (x, z, roll) => {
    const region = (regions(x * 0.08, z * 0.08) + 1) * 0.5 * TALUS_FAMILIES.length;
    const stray = roll < 0.15 ? 1 : 0;
    const index = Math.floor(region) + stray;
    return TALUS_FAMILIES[Math.max(0, index) % TALUS_FAMILIES.length]!;
  };
};
