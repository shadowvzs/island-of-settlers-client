import { createRandom, deriveSeed, type Random } from "../../shared/world/rng";
import { FISH_SPECIES, FISH_SPECIES_WEIGHTS } from "./fish-species";
import type { FishWater } from "./fish-water";

/** Where one school (or a pair, or a single reef fish) lives: a patch of clear shallow water. */
export interface FishHome {
  count: number;
  /** Radius (world units) the group wanders within. */
  radius: number;
  species: number;
  x: number;
  z: number;
}

/** Candidate spacing of the scan (world units) and the least distance between two homes. */
const SCAN_STEP = 2.5;
const HOME_SPACING = 7;
const HOME_RADIUS = 2.6;
/** Homes keep this far from the map edge (the open sea beyond is not drawn as a seabed). */
const EDGE_MARGIN = 6;
/** The shallow turquoise band: water between these depths... */
const BAND: readonly [number, number] = [0.45, 1.9];
/** ...within this reach of land (an island's shallows, not the open sea). */
const LAND_REACH = [3, 6, 9];
/** Least share of the wander ring that is swimmable water. */
const RING_WATER = 0.8;
const RING_SAMPLES = 10;
/** Shallowest water a fish swims in. */
export const FISH_MIN_DEPTH = 0.35;
const KEEP_SHARE = 0.6;

const isNearLand = (water: FishWater, x: number, z: number) => {
  for (const reach of LAND_REACH) {
    for (let step = 0; step < 12; step += 1) {
      const angle = (step / 12) * Math.PI * 2;
      if (water.depth(x + Math.cos(angle) * reach, z + Math.sin(angle) * reach) < 0.05) return true;
    }
  }
  return false;
};

const hasWaterRing = (water: FishWater, x: number, z: number) => {
  let wet = 0;
  for (let step = 0; step < RING_SAMPLES; step += 1) {
    const angle = (step / RING_SAMPLES) * Math.PI * 2;
    const depth = water.depth(x + Math.cos(angle) * HOME_RADIUS, z + Math.sin(angle) * HOME_RADIUS);
    if (depth >= FISH_MIN_DEPTH + 0.05) wet += 1;
  }
  return wet >= RING_SAMPLES * RING_WATER;
};

/**
 * A weighted species pick among those whose depth band holds the home's depth (only cold-water
 * fish around the snowy islands).
 */
const pickSpecies = (random: Random, depth: number, winter: boolean) => {
  let total = 0;
  const fits = (index: number) => {
    const species = FISH_SPECIES[index]!;
    return depth >= species.depth[0] && depth <= species.depth[1] && (!winter || species.coldWater);
  };
  for (let index = 0; index < FISH_SPECIES.length; index += 1) if (fits(index)) total += FISH_SPECIES_WEIGHTS[index]!;
  let pick = random() * total;
  for (let index = 0; index < FISH_SPECIES.length; index += 1) {
    if (!fits(index)) continue;
    pick -= FISH_SPECIES_WEIGHTS[index]!;
    if (pick <= 0) return index;
  }
  return -1;
};

/** Homes in a coarse grid of HOME_SPACING cells, so the spacing test reads only the neighbours. */
const createSpacingGrid = (width: number, height: number) => {
  const columns = Math.ceil(width / HOME_SPACING) + 1;
  const rows = Math.ceil(height / HOME_SPACING) + 1;
  const cells: FishHome[][] = Array.from({ length: columns * rows }, () => []);
  const cellOf = (x: number, z: number) => Math.floor(z / HOME_SPACING) * columns + Math.floor(x / HOME_SPACING);
  const isFree = (x: number, z: number) => {
    const column = Math.floor(x / HOME_SPACING), row = Math.floor(z / HOME_SPACING);
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const near = cells[(row + dz) * columns + column + dx];
        if (near?.some((home) => Math.hypot(home.x - x, home.z - z) < HOME_SPACING)) return false;
      }
    }
    return true;
  };
  return { add: (home: FishHome) => cells[cellOf(home.x, home.z)]!.push(home), isFree };
};

const tryHome = (water: FishWater, random: Random, x: number, z: number, winter: boolean): FishHome | null => {
  const depth = water.depth(x, z);
  if (depth < BAND[0] || depth > BAND[1]) return null;
  if (!hasWaterRing(water, x, z) || !isNearLand(water, x, z)) return null;
  const species = pickSpecies(random, depth, winter);
  if (species < 0) return null;
  const [fewest, most] = FISH_SPECIES[species]!.school;
  const count = fewest + Math.floor(random() * (most - fewest + 1));
  return { count, radius: HOME_RADIUS, species, x, z };
};

/**
 * Fixed homes of the fish (deterministic per world seed): a jittered scan of the clear shallow
 * band near the islands, homes at least HOME_SPACING apart, some left empty for variety.
 */
export const createFishHomes = (water: FishWater, winter: boolean): FishHome[] => {
  const { world } = water;
  const random = createRandom(deriveSeed(world.seed, "fish-schools"));
  const grid = createSpacingGrid(world.cellsX, world.cellsZ);
  const homes: FishHome[] = [];
  for (let z = EDGE_MARGIN; z < world.cellsZ - EDGE_MARGIN; z += SCAN_STEP) {
    for (let x = EDGE_MARGIN; x < world.cellsX - EDGE_MARGIN; x += SCAN_STEP) {
      const jitterX = x + (random() - 0.5) * SCAN_STEP;
      const jitterZ = z + (random() - 0.5) * SCAN_STEP;
      if (random() > KEEP_SHARE || !grid.isFree(jitterX, jitterZ)) continue;
      const home = tryHome(water, random, jitterX, jitterZ, winter);
      if (!home) continue;
      grid.add(home);
      homes.push(home);
    }
  }
  return homes;
};
