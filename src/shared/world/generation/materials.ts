import { DMath } from "../../math/deterministic-math";
import { getVertexCount, getVertexSlope, type GridSize } from "../grid-geometry";
import { writeSplatWeights } from "../ground-buffer";
import { clamp, createFbm, smoothstep } from "../noise";
import { deriveSeed } from "../rng";
import { MATERIAL, MATERIAL_COUNT } from "../world-data";
import { applyGroundChain } from "./ground-chain";
import type { ThemeParameters } from "./island-themes";
import { createPatchNoise } from "./prop-rules";
import { blurLandSplat } from "./splat-blur";
import type { ThemeSampler } from "./theme-field";
import type { TopographyFields } from "./topography-fields";
import { getPalmShare } from "./tree-rules";
import { REFERENCE_CELLS } from "./world-scale";

export interface BiomeFields {
  forest: Float32Array;
  moisture: Float32Array;
}

export interface MaterialInputs {
  coastDistance: Float32Array;
  heights: Float32Array;
  /** Per vertex 0..1 mine gravel touching the massif rock (splat only, mine-apron.ts). */
  massifContact: Float32Array;
  /** Per vertex 0..1 mine land and the open band around the massifs (mine-zones.ts). */
  massifFoot: Float32Array;
  /** Per vertex 0..1 mine ground and the mine zone per cell (mine-zones.ts). */
  mineGround: Float32Array;
  mineZone: Uint16Array;
  plateauMask: Float32Array;
  riverDistance: Float32Array;
  /** Distance (cells) to the sea per vertex, rivers excluded (distance-field.ts). */
  seaDistance: Float32Array;
  /** Stillness 0..1 of calm fresh water per vertex (still-water.ts): water plants grow there. */
  stillWater: Float32Array;
  /** Local island theme (ground, moisture, forest, vegetation) per vertex or position. */
  theme: ThemeSampler;
  waterDepth: Float32Array;
  waterSurface: Float32Array;
  /** Drainage wetness 0..1 (M01b): valleys stay moist even when no river reaches them. */
  wetness: Float32Array;
  /** Aspect, exposure and curvature fields (M02b). */
  topography: TopographyFields;
}

/** Grove threshold shift per unit of the forest amount (1 = the tuned default). */
const FOREST_SHIFT = 0.3;
/**
 * Above the default the extra woods go mostly to slopes too steep to build on (hills and mountain
 * flanks), so the building minimums do not cut them back: the share of the extra shift on flat
 * land, the slope range over which it reaches the full boost, and the boost on slopes.
 */
const MANY_FOREST = { flatShare: 0.15, slope: [0.12, 0.3], slopeBoost: 2 } as const;

const getForestShift = (forestAmount: number, themeForest: number, slope: number) => {
  const extra = Math.max(0, forestAmount - 1);
  const onSlope = smoothstep(MANY_FOREST.slope[0], MANY_FOREST.slope[1], slope);
  const boost = MANY_FOREST.flatShare + (MANY_FOREST.slopeBoost - MANY_FOREST.flatShare) * onSlope;
  return (Math.min(forestAmount, 1) - 1 + themeForest + extra * boost) * FOREST_SHIFT;
};

/**
 * Forest and moisture masks; the forest amount (0..2, 1 = default) thins or widens the groves
 * (the settlement clearings keep the building land, see clearings.ts). `wetness` is the nation
 * homeland's ground-wetness multiplier (NATION-TERRAIN, 1 = neutral).
 */
export const createBiomeFields = (
  grid: GridSize,
  seed: number,
  inputs: MaterialInputs,
  forestAmount: number,
  wetness = 1
): BiomeFields => {
  const count = getVertexCount(grid);
  const forest = new Float32Array(count);
  const moisture = new Float32Array(count);
  const forestNoise = createFbm(deriveSeed(seed, "forest"), { octaves: 4 });
  const moistureNoise = createFbm(deriveSeed(seed, "moisture"), { octaves: 3 });
  const stride = grid.cellsX + 1;
  for (let index = 0; index < count; index += 1) {
    const theme = inputs.theme.atVertex(index);
    const dryLand = theme.moisture;
    const vertexX = index % stride;
    const vertexZ = Math.floor(index / stride);
    const u = vertexX / REFERENCE_CELLS;
    const v = vertexZ / REFERENCE_CELLS;
    const height = inputs.heights[index]!;
    const slope = getVertexSlope(grid, inputs.heights, vertexX, vertexZ);
    const riverTerm = DMath.exp(-inputs.riverDistance[index]! / 7) * 0.8;
    const valleyTerm = smoothstep(0.35, 0.85, inputs.wetness[index]!) * 0.6;
    const noiseTerm = (moistureNoise(u * 3, v * 3) * 0.5 + 0.5) * 0.35 * dryLand;
    moisture[index] = clamp((Math.max(riverTerm, valleyTerm) + noiseTerm) * wetness, 0, 1);
    const forestShift = getForestShift(forestAmount, theme.forest, slope);
    const groveNoise = forestNoise(u * 3.4, v * 3.4) + moisture[index]! * 0.25 - 0.04 + forestShift +
      (0.5 - inputs.topography.heatLoad[index]!) * 0.12 +
      inputs.topography.curvature[index]! * 0.08 -
      Math.max(0, inputs.topography.exposure[index]!) * 0.1;
    const grove = smoothstep(0, 0.22, groveNoise);
    const allowed =
      smoothstep(0.35, 0.7, height) *
      (1 - smoothstep(5.5, 6.5, height)) *
      (1 - smoothstep(0.85, 1.25, slope)) *
      (1 - inputs.plateauMask[index]!) *
      smoothstep(2, 4, inputs.coastDistance[index]!);
    forest[index] = forestAmount <= 0 ? 0 : grove * allowed;
  }
  return { forest, moisture };
};

/** Settlement clearings are meadows: no forest (nor forest floor) inside them. */
export const fadeForest = (biome: BiomeFields, clearing: Float32Array): BiomeFields => ({
  forest: biome.forest.map((forest, index) => forest * (1 - clearing[index]!)),
  moisture: biome.moisture
});

interface VertexSample {
  coast: number;
  curvature: number;
  dirtNoise: number;
  exposure: number;
  heatLoad: number;
  forest: number;
  height: number;
  moisture: number;
  /** Patch noise (prop-rules.ts): moves the palm belt's inner border; 0 outside the forest. */
  patches: number;
  plateau: number;
  riverDistance: number;
  seaDistance: number;
  shoreNoise: number;
  slope: number;
  underwater: boolean;
}

/** Exposed stony soil between the soil and the rock: steeper ground and high mountain sides. */
const getStony = (sample: VertexSample) =>
  Math.min(
    1,
    smoothstep(0.5, 0.85, sample.slope + sample.dirtNoise * 0.12) * 0.85 +
      smoothstep(4.8, 6.2, sample.height) * 0.45 +
      smoothstep(0.3, 0.8, sample.exposure) * smoothstep(3, 5, sample.height) * 0.4
  );

/** Winter snow on open land: ground shows only in sheltered spots (under trees, river banks). */
const getSnowGround = (sample: VertexSample, theme: ThemeParameters) => {
  if (theme.snow <= 0) return 0;
  const riverBank = 1 - smoothstep(1, 3, sample.riverDistance);
  const shelter = Math.max(sample.forest * 0.55, riverBank * 0.6);
  return theme.snow * (1 - shelter);
};

/**
 * Theme ground on the vegetated share: dunes on dry open ground (wet river banks stay green),
 * winter snow, then stony patches. Returns the vegetated share left for grass, forest floor and
 * dirt.
 */
const addThemeGround = (
  sample: VertexSample,
  theme: ThemeParameters,
  vegetated: number,
  weights: Float32Array
) => {
  const dry = 1 - smoothstep(0.3, 0.6, sample.moisture);
  const grassPatch = 1 - smoothstep(-0.45, -0.15, sample.dirtNoise);
  const dune = theme.sand * dry * (1 - sample.forest * 0.7) * (1 - grassPatch * 0.65);
  const snow = getSnowGround(sample, theme) * (1 - dune);
  const stony = theme.gravel * smoothstep(0.1, 0.5, sample.dirtNoise) * (1 - dune) * (1 - snow);
  weights[MATERIAL.sand] = weights[MATERIAL.sand]! + vegetated * dune;
  weights[MATERIAL.snow] = weights[MATERIAL.snow]! + vegetated * snow;
  weights[MATERIAL.gravel] = weights[MATERIAL.gravel]! + vegetated * stony;
  return vegetated * (1 - dune) * (1 - snow) * (1 - stony);
};

/** Bare soil 0..1: noise patches, plateaus, river mud, slopes, plus the theme's dry soil. */
const getDirt = (sample: VertexSample, theme: ThemeParameters) => {
  const mud = (1 - smoothstep(1, 2.5, sample.riverDistance)) * 0.7;
  return Math.min(
    1,
    smoothstep(0.3, 0.6, sample.dirtNoise) * 0.75 +
      sample.plateau * 0.2 +
      mud +
      smoothstep(0.35, 0.6, sample.slope) * 0.45 +
      smoothstep(0.6, 0.9, sample.heatLoad) * smoothstep(0.25, 0.6, sample.slope) * 0.35 +
      theme.dirt * smoothstep(-0.5, 0.3, sample.dirtNoise)
  );
};

/**
 * Forest 0..1 of broadleaf, conifer and birch trees: palm groves are no forest, so their ground
 * stays sand, grass and dirt (the palm share as the tree species rules pick it, tree-rules.ts).
 */
const getWoodland = (sample: VertexSample, theme: ThemeParameters, sand: number) => {
  if (sample.forest <= 0) return 0;
  const { height, moisture, patches, seaDistance } = sample;
  const site = { height, moisture, patches, sand, seaDistance, vegetation: theme.vegetation };
  return sample.forest * (1 - getPalmShare(site));
};

/**
 * Layered rules: snow and rock win, then beach sand, then stony soil at the rock fringe, then
 * the theme ground (dunes, stony patches), then the vegetated grounds share the rest
 * (grass -> dirt -> stony soil -> rock up a slope). The lush grass layer is the clover meadow, placed
 * after the blur by applyCloverMeadows.
 */
const getMaterialWeights = (
  sample: VertexSample,
  theme: ThemeParameters,
  weights: Float32Array
) => {
  weights.fill(0);
  if (sample.underwater) {
    weights[MATERIAL.rock] = smoothstep(0.9, 1.5, sample.slope);
    weights[MATERIAL.sand] = 1 - weights[MATERIAL.rock]!;
    return;
  }
  const snow = smoothstep(7, 7.8, sample.height + sample.shoreNoise * 0.8);
  const rock = Math.min(
    1,
    smoothstep(0.75, 1.2, sample.slope) + smoothstep(5, 7, sample.height) * 0.55
  );
  const sand =
    (1 - smoothstep(0.8, 2 + sample.shoreNoise * 1.2, sample.coast)) *
    (1 - smoothstep(0.5, 1.0, sample.height));
  weights[MATERIAL.snow] = snow;
  weights[MATERIAL.rock] = rock * (1 - snow * 0.7);
  const open = (1 - snow) * (1 - rock);
  weights[MATERIAL.sand] = sand * open;
  const stony = getStony(sample) * (1 - sand);
  weights[MATERIAL.gravel] = stony * open;
  const vegetated = addThemeGround(sample, theme, open * (1 - sand) * (1 - stony), weights);
  const dirt = getDirt(sample, theme);
  const woodland = getWoodland(sample, theme, weights[MATERIAL.sand]!);
  weights[MATERIAL.forestFloor] = woodland * vegetated;
  weights[MATERIAL.dirt] = dirt * vegetated * (1 - woodland * 0.6);
  const used = weights[MATERIAL.forestFloor]! + weights[MATERIAL.dirt]!;
  weights[MATERIAL.grass] = Math.max(0, vegetated - used);
};

/**
 * Clover patches: moisture, patch noise, forest and slope windows (all soft: a hard window left one-cell splat jumps,
 * splat-blur.test), the most of the lawn, smallest byte, and the share blur radius (vertices).
 */
const CLOVER = {
  blurRadius: 1, forest: [0.15, 0.3], minimumByte: 8, moisture: [0.4, 0.7], noise: [0.0, 0.45], share: 0.85,
  slope: [0.1, 0.35]
} as const;

/** Clover share 0..1 of the lawn at a vertex (moist, flat, open meadow of a temperate theme). */
const getCloverShare = (theme: ThemeParameters, forest: number, moisture: number, noise: number, slope: number) => {
  if (theme.clover <= 0) return 0;
  return theme.clover * CLOVER.share * smoothstep(CLOVER.moisture[0], CLOVER.moisture[1], moisture) *
    smoothstep(CLOVER.noise[0], CLOVER.noise[1], noise) * (1 - smoothstep(CLOVER.slope[0], CLOVER.slope[1], slope)) *
    (1 - smoothstep(CLOVER.forest[0], CLOVER.forest[1], forest));
};

/** Box blur of a vertex field (clamped at the edges): patch edges spread over neighbouring vertices. */
const blurVertexField = (grid: GridSize, field: Float32Array, radius: number) => {
  const stride = grid.cellsX + 1, rows = grid.cellsZ + 1;
  const result = new Float32Array(field.length);
  for (let z = 0; z < rows; z += 1) for (let x = 0; x < stride; x += 1) {
    let sum = 0, count = 0;
    for (let dz = -radius; dz <= radius; dz += 1) for (let dx = -radius; dx <= radius; dx += 1) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= stride || nz >= rows) continue;
      sum += field[nz * stride + nx]!;
      count += 1;
    }
    result[z * stride + x] = sum / count;
  }
  return result;
};

/**
 * Clover meadow (GROUND-PALETTE, owner 2026-11-17): sparse noise patches of the lawn turn into the lush grass
 * layer. The generator's last splat pass (generate-world.ts, after every other ground and build step): only the
 * grass byte moves to the lush grass byte, so no other material, walk cost or build value changes (an earlier
 * pass shifted the byte rounding of later green-ground steps); bytes below CLOVER.minimumByte stay grass (the
 * ground shader samples a layer from weight 1/255 on, so a faint fringe would cost fetches for nothing). The share
 * field is blurred over neighbouring vertices first, so a patch edge is a soft blend, never a one-cell swap.
 */
export const applyCloverMeadows = (grid: GridSize, seed: number, splat: Uint8Array, inputs: MaterialInputs,
  biome: BiomeFields) => {
  const noise = createFbm(deriveSeed(seed, "clover"), { octaves: 3 });
  const stride = grid.cellsX + 1;
  const shares = new Float32Array(getVertexCount(grid));
  for (let index = 0; index < shares.length; index += 1) {
    if (inputs.waterDepth[index]! > 0.02) continue;
    const vertexX = index % stride, vertexZ = Math.floor(index / stride);
    shares[index] = getCloverShare(inputs.theme.atVertex(index), biome.forest[index]!, biome.moisture[index]!,
      noise(vertexX / REFERENCE_CELLS * 14, vertexZ / REFERENCE_CELLS * 14),
      getVertexSlope(grid, inputs.heights, vertexX, vertexZ));
  }
  const blurred = blurVertexField(grid, shares, CLOVER.blurRadius);
  for (let index = 0; index < shares.length; index += 1) {
    const offset = index * MATERIAL_COUNT;
    const grass = splat[offset + MATERIAL.grass]!;
    if (grass < CLOVER.minimumByte || inputs.waterDepth[index]! > 0.02) continue;
    const clover = Math.round(grass * blurred[index]!);
    if (clover < CLOVER.minimumByte) continue;
    splat[offset + MATERIAL.grass] = grass - clover;
    splat[offset + MATERIAL.lushGrass] = splat[offset + MATERIAL.lushGrass]! + clover;
  }
};

/**
 * The ground splat per vertex, softened over land (splat-blur.ts), then the ground chain
 * (rock -> pebbles -> soil -> green ground, ground-chain.ts).
 */
export const createSplat = (
  grid: GridSize,
  seed: number,
  inputs: MaterialInputs,
  biome: BiomeFields
) => {
  const count = getVertexCount(grid);
  const splat = new Uint8Array(count * MATERIAL_COUNT);
  const weights = new Float32Array(MATERIAL_COUNT);
  const dirtNoise = createFbm(deriveSeed(seed, "dirt"), { octaves: 4 });
  const shoreNoise = createFbm(deriveSeed(seed, "shore"), { octaves: 3 });
  const patchNoise = createPatchNoise(seed);
  const stride = grid.cellsX + 1;
  for (let index = 0; index < count; index += 1) {
    const vertexX = index % stride;
    const vertexZ = Math.floor(index / stride);
    const u = vertexX / REFERENCE_CELLS;
    const v = vertexZ / REFERENCE_CELLS;
    const forest = biome.forest[index]!;
    getMaterialWeights(
      {
        coast: inputs.coastDistance[index]!,
        curvature: inputs.topography.curvature[index]!,
        dirtNoise: dirtNoise(u * 9, v * 9),
        exposure: inputs.topography.exposure[index]!,
        heatLoad: inputs.topography.heatLoad[index]!,
        forest,
        height: inputs.heights[index]!,
        moisture: biome.moisture[index]!,
        patches: forest > 0 ? patchNoise(vertexX, vertexZ) : 0,
        plateau: inputs.plateauMask[index]!,
        riverDistance: inputs.riverDistance[index]!,
        seaDistance: inputs.seaDistance[index]!,
        shoreNoise: shoreNoise(u * 12, v * 12),
        slope: getVertexSlope(grid, inputs.heights, vertexX, vertexZ),
        underwater: inputs.waterDepth[index]! > 0.02
      },
      inputs.theme.atVertex(index),
      weights
    );
    writeSplatWeights(splat, index, weights);
  }
  blurLandSplat(grid, splat, inputs.coastDistance);
  applyGroundChain(grid, seed, splat, inputs.theme);
  return splat;
};
