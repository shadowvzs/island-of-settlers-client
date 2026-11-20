import { type GridSize, sampleBilinear, sampleSmooth } from "../grid-geometry";
import { createFbm, type Noise2,smoothstep } from "../noise";
import { quantisePropPosition } from "../prop-quantum";
import { createKeyedRandom, deriveSeed, type Random, randomInRange } from "../rng";
import { PROP } from "../world-data";
import {
  chooseWaterEdgePlant,
  createSpeciesNoise,
  drawPropMotion,
  SHALLOWS_DEPTH
} from "./prop-rules";
import type { PlacedProp } from "./props";

/** Water depth range of the floating lily pads (their stems reach the bed). */
export const LILY_DEPTH = [0.15, 1.2] as const;
/** Reed and cattail beds wade out to this depth (the bank pass covers up to SHALLOWS_DEPTH). */
export const REED_BED_DEPTH = 0.45;
/** Stillness (still-water.ts) a lily and a reed bed need at their spot. */
export const LILY_STILLNESS = 0.5;
export const REED_BED_STILLNESS = 0.35;
/** Wading stems stand this far below the surface: the water line cuts them (contact). */
const WATER_PLANT_SINK = 0.06;
/** The pads float this far above the water mesh (no z-fighting with the surface). */
export const LILY_FLOAT = 0.015;
/** Reed beds stay in the lowland rivers (as the bank reeds, prop-rules.ts). */
const REED_BED_MAX_HEIGHT = 3.5;
const LILY_SCALE = [0.75, 1.25] as const;
const REED_SCALE = [0.7, 1.2] as const;
/** Wading beds lean to reeds (cattails are the heavier mesh, see the cattail budget test). */
const BED_SPECIES_SHIFT = -0.35;

interface WaterPlantRule {
  spacing: number;
  stillness: number;
  /** Candidate points per cell of still water. */
  tries: number;
}

const REED_BED: WaterPlantRule = { spacing: 0.45, stillness: REED_BED_STILLNESS, tries: 4 };
const LILY: WaterPlantRule = { spacing: 0.6, stillness: LILY_STILLNESS, tries: 3 };
/** Lilies keep this far from reed stems. */
const LILY_REED_CLEARANCE = 0.45;

export interface WaterPlantInputs {
  heights: Float32Array;
  stillWater: Float32Array;
  waterSurface: Float32Array;
}

/** Foot height of a plant: the ground, or just below the surface where it wades in water. */
export const getWaterlineFoot = (ground: number, surface: number) =>
  Math.max(ground, surface - WATER_PLANT_SINK);

/** Spatial hash of placed stems (cell buckets): the free test checks the 3 x 3 neighbours. */
const createStemIndex = () => {
  const buckets = new Map<number, PlacedProp[]>();
  const key = (x: number, z: number) => Math.floor(x) * 4096 + Math.floor(z);
  const add = (prop: PlacedProp) => {
    const bucket = buckets.get(key(prop.x, prop.z)) ?? [];
    bucket.push(prop);
    buckets.set(key(prop.x, prop.z), bucket);
  };
  const isFree = (x: number, z: number, spacing: (type: number) => number) => {
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        for (const prop of buckets.get(key(x + dx, z + dz)) ?? []) {
          if (Math.hypot(prop.x - x, prop.z - z) < spacing(prop.type)) return false;
        }
      }
    }
    return true;
  };
  return { add, isFree };
};

type StemIndex = ReturnType<typeof createStemIndex>;

interface WaterSpot {
  depth: number;
  ground: number;
  still: number;
  surface: number;
  x: number;
  z: number;
}

const readSpot = (grid: GridSize, inputs: WaterPlantInputs, rawX: number, rawZ: number): WaterSpot => {
  // Quantise before sampling: the stillness and depth checks must match the stored position (S05b).
  const x = quantisePropPosition(rawX);
  const z = quantisePropPosition(rawZ);
  const ground = sampleSmooth(grid, inputs.heights, x, z);
  const surface = sampleBilinear(grid, inputs.waterSurface, x, z);
  const still = sampleBilinear(grid, inputs.stillWater, x, z);
  return { depth: surface - ground, ground, still, surface, x, z };
};

/** Highest stillness at a cell's corners (cells without still water are skipped at once). */
const getCellStillness = (grid: GridSize, still: Float32Array, cellX: number, cellZ: number) => {
  const index = cellZ * (grid.cellsX + 1) + cellX;
  const below = index + grid.cellsX + 1;
  return Math.max(still[index]!, still[index + 1]!, still[below]!, still[below + 1]!);
};

/**
 * Visits candidate points of every cell with enough still water, in a fixed order; every cell
 * draws from its own stream (`label`), so a cell's plants depend on that cell only.
 */
const forEachStillPoint = (
  grid: GridSize,
  inputs: WaterPlantInputs,
  rule: WaterPlantRule,
  stream: { label: string; seed: number },
  visit: (spot: WaterSpot, random: Random) => void
) => {
  const cellRandom = createKeyedRandom(deriveSeed(stream.seed, stream.label));
  for (let cellZ = 0; cellZ < grid.cellsZ; cellZ += 1) {
    for (let cellX = 0; cellX < grid.cellsX; cellX += 1) {
      if (getCellStillness(grid, inputs.stillWater, cellX, cellZ) < rule.stillness) continue;
      const random = cellRandom(cellZ * grid.cellsX + cellX);
      for (let attempt = 0; attempt < rule.tries; attempt += 1) {
        const spot = readSpot(grid, inputs, cellX + random(), cellZ + random());
        if (spot.still >= rule.stillness) visit(spot, random);
      }
    }
  }
};

/** Dense beds near the banks: shallower water and the bed noise make them thicker. */
const getReedBedChance = (spot: WaterSpot, beds: Noise2) => {
  if (spot.depth <= SHALLOWS_DEPTH || spot.depth > REED_BED_DEPTH) return 0;
  if (spot.ground > REED_BED_MAX_HEIGHT) return 0;
  const bed = smoothstep(-0.1, 0.25, beds(spot.x * 0.22, spot.z * 0.22));
  const shallow = 1 - smoothstep(0.25, REED_BED_DEPTH, spot.depth);
  return spot.still * bed * (0.35 + 0.65 * shallow);
};

/** Loose lily clusters on calm water deep enough to float, never in the shallow fringe. */
const getLilyChance = (spot: WaterSpot, patches: Noise2) => {
  const [shallowest, deepest] = LILY_DEPTH;
  if (spot.depth < shallowest || spot.depth > deepest) return 0;
  const patch = smoothstep(-0.05, 0.3, patches(spot.x * 0.2, spot.z * 0.2));
  const depth =
    smoothstep(shallowest, 0.25, spot.depth) * (1 - smoothstep(0.9, deepest, spot.depth));
  return spot.still * patch * depth * 0.6;
};

const placeReedBeds = (
  grid: GridSize,
  inputs: WaterPlantInputs,
  context: { seed: number; stems: StemIndex }
) => {
  const { seed, stems } = context;
  const beds = createFbm(deriveSeed(seed, "reed-beds"), { octaves: 2 });
  const species = createSpeciesNoise(seed);
  const placed: PlacedProp[] = [];
  const stream = { label: "reed-bed-picks", seed };
  forEachStillPoint(grid, inputs, REED_BED, stream, (spot, random) => {
    if (random() >= getReedBedChance(spot, beds)) return;
    if (!stems.isFree(spot.x, spot.z, () => REED_BED.spacing)) return;
    const type = chooseWaterEdgePlant(species(spot.x, spot.z) + BED_SPECIES_SHIFT, random);
    const y = getWaterlineFoot(spot.ground, spot.surface);
    const scale = randomInRange(random, REED_SCALE);
    const prop = { ...drawPropMotion(random), scale, type, x: spot.x, y, z: spot.z };
    stems.add(prop);
    placed.push(prop);
  });
  return placed;
};

const getLilySpacing = (type: number) =>
  type === PROP.waterLily ? LILY.spacing : LILY_REED_CLEARANCE;

const placeLilies = (
  grid: GridSize,
  inputs: WaterPlantInputs,
  context: { seed: number; stems: StemIndex }
) => {
  const { seed, stems } = context;
  const patches = createFbm(deriveSeed(seed, "lily-patches"), { octaves: 2 });
  const placed: PlacedProp[] = [];
  const stream = { label: "lily-picks", seed };
  forEachStillPoint(grid, inputs, LILY, stream, (spot, random) => {
    if (random() >= getLilyChance(spot, patches)) return;
    if (!stems.isFree(spot.x, spot.z, getLilySpacing)) return;
    const y = spot.surface + LILY_FLOAT;
    const prop = {
      ...drawPropMotion(random),
      scale: randomInRange(random, LILY_SCALE),
      type: PROP.waterLily,
      x: spot.x,
      y,
      z: spot.z
    };
    stems.add(prop);
    placed.push(prop);
  });
  return placed;
};

/**
 * Water plants of calm fresh water (still-water.ts), deterministic per seed: reed and cattail
 * beds wading out from the banks (beyond the bank pass's shallows), then water lily clusters on
 * the calm stretches and plunge pools, clear of the stems. `banks` are the props placed so far
 * (the wetland edge plants keep their room).
 */
export const placeWaterPlants = (
  grid: GridSize,
  seed: number,
  inputs: WaterPlantInputs,
  banks: readonly PlacedProp[]
) => {
  const stems = createStemIndex();
  for (const prop of banks) {
    if (prop.type === PROP.reeds || prop.type === PROP.cattail) stems.add(prop);
  }
  const context = { seed, stems };
  const reeds = placeReedBeds(grid, inputs, context);
  return [...reeds, ...placeLilies(grid, inputs, context)];
};
