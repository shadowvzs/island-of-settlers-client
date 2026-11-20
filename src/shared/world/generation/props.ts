import { getVertexSlope, type GridSize,sampleBilinear, sampleSmooth } from "../grid-geometry";
import { createFbm, type Noise2 } from "../noise";
import { propPhase, quantisePropPosition, quantisePropRotation, quantisePropScale } from "../prop-quantum";
import { createKeyedRandom, createRandom, deriveSeed, type Random } from "../rng";
import { createMountainField, getRockSkinCover } from "../rock-cover";
import { MATERIAL, MATERIAL_COUNT, PROP, type PropSet } from "../world-data";
import { computeDistanceField } from "./distance-field";
import { isBlockingProp } from "./gameplay";
import type { BiomeFields, MaterialInputs } from "./materials";
import { samplePoissonDisc } from "./poisson-disc";
import {
  chooseDuneProp,
  chooseMeadowProp,
  chooseShoreProp,
  chooseUndergrowth,
  createPatchNoise,
  createSpeciesNoise,
  drawPropMotion,
  isRockCovered,
  isUnderRockSkin,
  NONE,
  type PropSample,
  SAND_GROUND,
  SHALLOWS_DEPTH} from "./prop-rules";
import { createRockyCells, fitTrunkAwayFromRock } from "./rock-clearance";
import { createShrubFilter } from "./shrub-rules";
import {
  chooseSoftwoodSpecies,
  chooseTreeForm,
  getTreeChance,
  getTreeFacing,
  getTreeScale
} from "./tree-rules";
import { placeWaterPlants } from "./water-plants";

/**
 * Minimum trunk distance (cells): forest cores about 1.8 apart, the edges sparser by chance
 * (tree-rules.ts), so crowns close without a planted, grid like look.
 */
export const TREE_SPACING = 1.65;
const SMALL_SPACING = 0.6;
const TRUNK_CLEARANCE = 0.55;
const NO_TRUNK_NEARBY = 2;
/** Step (cells) of the forest mask gradient: forest edges face down it. */
const FOREST_STEP = 1;
/** Step of the central differences for the exact surface slope (as the rock skin uses). */
const SLOPE_STEP = 0.25;
/** Root zone around a spot that must stay clear of the rock skin (a trunk and its flare). */
const ROOT_ZONE_RADIUS = 0.4;
/** The spot itself and eight points around it. */
const ROOT_ZONE_POINTS: [number, number][] = [
  [0, 0],
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((step): [number, number] => [
    Math.cos((step * Math.PI) / 4) * ROOT_ZONE_RADIUS,
    Math.sin((step * Math.PI) / 4) * ROOT_ZONE_RADIUS
  ])
];
/** Dune grass grows from here up the beach (the wet sand below stays bare). */
const DUNE_COAST_MIN = 1;
/** Mountain rock: rock ground above the hills (sea cliffs and plateau edges do not count). */
const MOUNTAIN_ROCK = 0.5;
const MOUNTAIN_HEIGHT = 3;
/** Mine gravel share that counts as the mountain's foot (props reach fields). */
const MINE_GRAVEL = 0.5;

const SMALL_SCALE: Record<number, [number, number]> = {
  [PROP.largeRock]: [0.8, 1.5],
  [PROP.smallRock]: [0.5, 1.2]
};

/** Material inputs plus the settlement clearings (per vertex 0..1, see clearings.ts). */
export interface PropInputs extends MaterialInputs {
  clearing: Float32Array;
}

export interface PlacedProp {
  /** Structural form byte (tree-forms.ts); 0 when the prop has none. */
  form?: number;
  /** Wind sway phase (radians). */
  phase: number;
  /** Facing (radians; forest edge conifers turn their heavy side to the open land). */
  rotation: number;
  scale: number;
  type: number;
  x: number;
  y: number;
  z: number;
}

const readMaterial = (
  grid: GridSize,
  splat: Uint8Array,
  material: number,
  x: number,
  z: number
) => {
  const index = Math.round(z) * (grid.cellsX + 1) + Math.round(x);
  return (splat[index * MATERIAL_COUNT + material] ?? 0) / 255;
};

/**
 * Distance to the mountain per vertex in cells. The mountain is its rock plus the open band
 * around it (mine land and the meadow at its foot), so the mountain-foot trees (mountain pine)
 * form the tree line at the band's edge.
 */
const createMountainDistance = (grid: GridSize, inputs: MaterialInputs, splat: Uint8Array) => {
  const isMountainRock = (index: number) =>
    inputs.massifFoot[index]! > MINE_GRAVEL ||
    (inputs.heights[index]! > MOUNTAIN_HEIGHT &&
      splat[index * MATERIAL_COUNT + MATERIAL.rock]! / 255 > MOUNTAIN_ROCK);
  return computeDistanceField(grid, isMountainRock);
};

/** Exact slope of the smooth surface (rise per cell) at a point. */
const getSurfaceSlope = (grid: GridSize, heights: Float32Array, x: number, z: number) => {
  const dx =
    sampleSmooth(grid, heights, x + SLOPE_STEP, z) - sampleSmooth(grid, heights, x - SLOPE_STEP, z);
  const dz =
    sampleSmooth(grid, heights, x, z + SLOPE_STEP) - sampleSmooth(grid, heights, x, z - SLOPE_STEP);
  return Math.hypot(dx, dz) / (SLOPE_STEP * 2);
};

/** Highest rock skin cover at the spot and around its root zone. */
const getRootZoneRockSkin = (
  grid: GridSize,
  heights: Float32Array,
  mountain: Float32Array,
  x: number,
  z: number
) => {
  let cover = 0;
  for (const [offsetX, offsetZ] of ROOT_ZONE_POINTS) {
    const pointX = x + offsetX;
    const pointZ = z + offsetZ;
    const share = sampleBilinear(grid, mountain, pointX, pointZ);
    if (share <= 0) continue;
    const slope = getSurfaceSlope(grid, heights, pointX, pointZ);
    cover = Math.max(cover, getRockSkinCover(slope, share));
  }
  return cover;
};

/** Reads every field the rules need at one spot. */
const createSampler = (
  grid: GridSize,
  seed: number,
  inputs: MaterialInputs,
  biome: BiomeFields,
  splat: Uint8Array
) => {
  const mountainDistance = createMountainDistance(grid, inputs, splat);
  const mountain = createMountainField(grid, inputs.heights);
  const species = createSpeciesNoise(seed);
  const patches = createPatchNoise(seed);
  const clusters: Noise2 = createFbm(deriveSeed(seed, "plant-clusters"), { octaves: 2 });
  const grain: Noise2 = createFbm(deriveSeed(seed, "plant-grain"), { octaves: 2 });
  const stands: Noise2 = createFbm(deriveSeed(seed, "conifer-stands"), { octaves: 2 });
  const groves: Noise2 = createFbm(deriveSeed(seed, "birch-groves"), { octaves: 2 });
  const forestAt = (pointX: number, pointZ: number) =>
    sampleBilinear(grid, biome.forest, pointX, pointZ);
  return (x: number, z: number): PropSample => {
    const height = sampleSmooth(grid, inputs.heights, x, z);
    const surfaceSlope = getSurfaceSlope(grid, inputs.heights, x, z);
    return {
      cluster: clusters(x * 0.3, z * 0.3),
      coast: sampleBilinear(grid, inputs.coastDistance, x, z),
      curvature: sampleBilinear(grid, inputs.topography.curvature, x, z),
      depth: sampleBilinear(grid, inputs.waterDepth, x, z),
      exposure: sampleBilinear(grid, inputs.topography.exposure, x, z),
      forest: forestAt(x, z),
      forestSlopeX:
        (forestAt(x + FOREST_STEP, z) - forestAt(x - FOREST_STEP, z)) / (2 * FOREST_STEP),
      forestSlopeZ:
        (forestAt(x, z + FOREST_STEP) - forestAt(x, z - FOREST_STEP)) / (2 * FOREST_STEP),
      grain: grain(x * 1.1, z * 1.1),
      grove: groves(x * 0.07, z * 0.07),
      heatLoad: sampleBilinear(grid, inputs.topography.heatLoad, x, z),
      height,
      moisture: sampleBilinear(grid, biome.moisture, x, z),
      mountainDistance: sampleBilinear(grid, mountainDistance, x, z),
      patches: patches(x, z),
      plateau: sampleBilinear(grid, inputs.plateauMask, x, z),
      riverDistance: sampleBilinear(grid, inputs.riverDistance, x, z),
      rock: readMaterial(grid, splat, MATERIAL.rock, x, z),
      rockSkin: getRootZoneRockSkin(grid, inputs.heights, mountain, x, z),
      sand: readMaterial(grid, splat, MATERIAL.sand, x, z),
      seaDistance: sampleBilinear(grid, inputs.seaDistance, x, z),
      slope: getVertexSlope(grid, inputs.heights, Math.round(x), Math.round(z)),
      species: species(x, z),
      stand: stands(x * 0.05, z * 0.05),
      surfaceSlope,
      trunkDistance: NO_TRUNK_NEARBY,
      vegetation: inputs.theme.at(x, z).vegetation
    };
  };
};

/** Rock share of a cell's corners from which the whole cell counts as rock ground. */
const ROCKY_CELL_ROCK = 0.4;

/** Rock ground per cell: rock material at a corner, or rock face / skin at the cell centre. */
const createTreeRockMask = (
  grid: GridSize,
  splat: Uint8Array,
  sample: (x: number, z: number) => PropSample
) =>
  createRockyCells(grid, (cellX, cellZ) => {
    for (const [dx, dz] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1]
    ] as const) {
      if (readMaterial(grid, splat, MATERIAL.rock, cellX + dx, cellZ + dz) > ROCKY_CELL_ROCK) {
        return true;
      }
    }
    return isRockCovered(sample(cellX + 0.5, cellZ + 0.5));
  });

/**
 * Candidate points (pure geometry, own stream) and a stream of its own per point, so what one
 * spot draws (sea or land) never shifts another's: land placement depends on land data only.
 */
const createCandidates = (grid: GridSize, seed: number, spacing: number, label: string) => ({
  pickRandom: createKeyedRandom(deriveSeed(seed, `${label}-picks`)),
  points: samplePoissonDisc(
    grid.cellsX,
    grid.cellsZ,
    spacing,
    createRandom(deriveSeed(seed, `${label}-points`))
  )
});

/**
 * Pass 1: trees on wide Poisson spacing (they need room for their crowns). Never on rock ground;
 * next to rock the trunk moves inside its cell, away from the rocky neighbour's edge.
 */
const placeTrees = (
  grid: GridSize,
  sample: (x: number, z: number) => PropSample,
  inputs: { clearing: Float32Array; splat: Uint8Array },
  seed: number,
  density: number,
  spacing: number
) => {
  const placed: PlacedProp[] = [];
  const rocky = createTreeRockMask(grid, inputs.splat, sample);
  const { pickRandom, points } = createCandidates(grid, seed, spacing, "trees");
  for (let index = 0; index < points.length; index += 2) {
    const fitted = fitTrunkAwayFromRock(grid, rocky, points[index]!, points[index + 1]!);
    if (!fitted) continue;
    // Quantise before sampling: the stored y is the surface at the stored position (S05b).
    const x = quantisePropPosition(fitted[0]);
    const z = quantisePropPosition(fitted[1]);
    const spot = sample(x, z);
    const openness = 1 - sampleBilinear(grid, inputs.clearing, x, z);
    const random = pickRandom(index);
    if (random() >= getTreeChance(spot) * openness * density) continue;
    const type = chooseSoftwoodSpecies(spot, random);
    const form = chooseTreeForm(spot, type, random);
    const scale = getTreeScale(spot, type, random, form);
    const motion = drawPropMotion(random, getTreeFacing(spot, type, form));
    placed.push({ ...motion, form, scale, type, x, y: spot.height, z });
  }
  return placed;
};

/** Spatial hash of trunk positions: distance to the nearest trunk (capped) for undergrowth. */
const createTrunkIndex = (trees: PlacedProp[]) => {
  const buckets = new Map<number, PlacedProp[]>();
  const key = (x: number, z: number) => Math.floor(x) * 4096 + Math.floor(z);
  for (const tree of trees) {
    const bucket = buckets.get(key(tree.x, tree.z)) ?? [];
    bucket.push(tree);
    buckets.set(key(tree.x, tree.z), bucket);
  }
  return (x: number, z: number) => {
    let nearest = NO_TRUNK_NEARBY;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        for (const tree of buckets.get(key(x + dx, z + dz)) ?? []) {
          nearest = Math.min(nearest, Math.hypot(tree.x - x, tree.z - z));
        }
      }
    }
    return nearest;
  };
};

/** Land plant by ground: dune grass on the beach, undergrowth in the forest, else meadow. */
const chooseGroundProp = (spot: PropSample, random: Random) => {
  if (spot.depth > 0.02 || spot.coast < DUNE_COAST_MIN || isRockCovered(spot)) return NONE;
  if (spot.sand >= SAND_GROUND) return chooseDuneProp(spot, random);
  if (spot.coast < 1.6) return NONE;
  return spot.forest > 0.05 ? chooseUndergrowth(spot, random) : chooseMeadowProp(spot, random);
};

/** Spots a small prop skips: deep water, a trunk's root zone and the mountain skin. */
const isSmallPropBlocked = (spot: PropSample) =>
  spot.depth > SHALLOWS_DEPTH || spot.trunkDistance < TRUNK_CLEARANCE || isUnderRockSkin(spot);

/** Clearings keep their flowers and grasses; blocking plants and stones thin out towards them. */
const isClearedAway = (type: number, clearing: number, random: Random) =>
  clearing > 0 && isBlockingProp(type) && random() < clearing;

/**
 * Pass 2: wetland plants, beach grass, forest understory and meadow details, denser spacing;
 * bushes filtered by the theme (density, margin inside their ground).
 */
const placeSmallProps = (
  grid: GridSize,
  sample: (x: number, z: number) => PropSample,
  getTrunkDistance: (x: number, z: number) => number,
  ground: { clearing: Float32Array; splat: Uint8Array },
  seed: number
) => {
  const { clearing, splat } = ground;
  const keepShrub = createShrubFilter(grid, splat);
  const placed: PlacedProp[] = [];
  const { pickRandom, points } = createCandidates(grid, seed, SMALL_SPACING, "small-props");
  for (let index = 0; index < points.length; index += 2) {
    const x = quantisePropPosition(points[index]!);
    const z = quantisePropPosition(points[index + 1]!);
    const spot = { ...sample(x, z), trunkDistance: getTrunkDistance(x, z) };
    if (isSmallPropBlocked(spot)) continue;
    const random = pickRandom(index);
    const shoreType = chooseShoreProp(spot, random);
    const type = shoreType === NONE ? chooseGroundProp(spot, random) : shoreType;
    if (type === NONE || isClearedAway(type, sampleBilinear(grid, clearing, x, z), random)) {
      continue;
    }
    if (!keepShrub(type, { ...spot, x, z }, random)) continue;
    const [min, max] = SMALL_SCALE[type] ?? [0.7, 1.2];
    const scale = min + random() * (max - min);
    placed.push({ ...drawPropMotion(random), scale, type, x, y: spot.height, z });
  }
  return placed;
};

const toPropSet = (placed: PlacedProp[], seed: number): PropSet => {
  // Stable row-major order: the spatial id is the prop id, so later indices do not move a tree.
  const sorted = placed.map((prop, index) => ({
    index,
    prop,
    x: quantisePropPosition(prop.x),
    z: quantisePropPosition(prop.z)
  })).sort((a, b) =>
    Math.floor(a.z) - Math.floor(b.z) || a.x - b.x || a.index - b.index);
  const count = sorted.length;
  return {
    count,
    form: Uint8Array.from(sorted, (entry) => entry.prop.form ?? 0),
    phase: Float32Array.from({ length: count }, (_, id) => propPhase(seed, id)),
    rotation: Float32Array.from(sorted, (entry) => quantisePropRotation(entry.prop.rotation)),
    scale: Float32Array.from(sorted, (entry) => quantisePropScale(entry.prop.scale)),
    types: Uint8Array.from(sorted, (entry) => entry.prop.type),
    x: Float32Array.from(sorted, (entry) => entry.x),
    y: Float32Array.from(sorted, (entry) => entry.prop.y),
    z: Float32Array.from(sorted, (entry) => entry.z)
  };
};

/**
 * Ecological placement: trees first (palms on the coast, broadleaf inland, conifers at the
 * mountain foot; stands, clearings, thinning edges, lone meadow trees), then undergrowth that
 * keeps clear of trunks, meadow flowers in patches, dune grass on the beach, shore reeds, and
 * the water plants of calm fresh water (reed beds, lilies).
 * Settlement clearings override the vegetation: no tree, bush or stone inside them.
 */
export const placeProps = (
  grid: GridSize,
  seed: number,
  inputs: PropInputs,
  biome: BiomeFields,
  splat: Uint8Array,
  treeDensity = 1,
  treeSpacing = TREE_SPACING
): PropSet => {
  const sample = createSampler(grid, seed, inputs, biome, splat);
  const trees = placeTrees(grid, sample, { clearing: inputs.clearing, splat }, seed, treeDensity, treeSpacing);
  const trunkIndex = createTrunkIndex(trees);
  const ground = { clearing: inputs.clearing, splat };
  const small = placeSmallProps(grid, sample, trunkIndex, ground, seed);
  const water = placeWaterPlants(grid, seed, inputs, small);
  return toPropSet([...trees, ...small, ...water], seed);
};
