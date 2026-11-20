import { THEME_COUNT } from "../../src/shared/world/generation/island-themes";
import { samplePoissonDisc } from "../../src/shared/world/generation/poisson-disc";
import { createRandom, type Random } from "../../src/shared/world/rng";
import {
  BLOCKING,
  BUILD,
  FOG,
  MATERIAL,
  MATERIAL_COUNT,
  NO_MINE_ZONE,
  PROP,
  type PropSet,
  type WorldData
} from "../../src/shared/world/world-data";

export interface SyntheticDenseWorldOptions {
  /** Map side in cells (the world has cells x cells cells). */
  cells: number;
  seed: number;
  /** Minimum distance between small props (bushes, rocks) in cells; the generator uses 0.6. */
  smallPropSpacing?: number;
  /** Minimum distance between trees in cells (the owner's D-S8 floor is 1.2). */
  treeSpacing: number;
}

/** Small props (bushes, rocks, flowers) use the generator's spacing by default. */
const DEFAULT_SMALL_PROP_SPACING = 0.6;
const SEA_LEVEL = 0;
const SMALL_PROP_TYPES = [PROP.bush, PROP.smallRock, PROP.flowers, PROP.mushrooms] as const;
const HEIGHT_NOISE = 0.03;

/**
 * Deterministic island: one smooth hill rising from the sea, with a little noise so the layers do
 * not compress to nothing. Only for codec, limit and measurement tests (never a generator output).
 */
const createHeights = (cells: number, random: Random) => {
  const side = cells + 1;
  const heights = new Float32Array(side * side);
  const centre = cells / 2;
  for (let row = 0; row < side; row += 1) {
    for (let column = 0; column < side; column += 1) {
      const distance = Math.hypot(column - centre, row - centre) / centre;
      const ridge = Math.sin(column / 23) * Math.cos(row / 31);
      const noise = (random() - 0.5) * HEIGHT_NOISE;
      heights[row * side + column] = Math.fround(3.2 - distance * 4.4 + ridge * 0.4 + noise);
    }
  }
  return heights;
};

const createSplat = (heights: Float32Array, random: Random) => {
  const splat = new Uint8Array(heights.length * MATERIAL_COUNT);
  for (let vertex = 0; vertex < heights.length; vertex += 1) {
    const material = heights[vertex]! < 0.3 ? MATERIAL.sand : MATERIAL.grass;
    const mixed = random() < 0.2 ? MATERIAL.dirt : material;
    splat[vertex * MATERIAL_COUNT + material] = 200;
    splat[vertex * MATERIAL_COUNT + mixed] = (splat[vertex * MATERIAL_COUNT + mixed] ?? 0) + 55;
  }
  return splat;
};

const createThemeWeights = (vertexCount: number) => {
  const weights = new Uint8Array(vertexCount * THEME_COUNT);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) weights[vertex * THEME_COUNT] = 255;
  return weights;
};

const createWaterDepth = (heights: Float32Array, surface: Float32Array) =>
  Float32Array.from(heights, (height, index) => Math.fround(Math.max(0, surface[index]! - height)));

const createProps = (
  cells: number,
  spacing: { small: number; tree: number },
  heights: Float32Array,
  random: Random
) => {
  const side = cells + 1;
  const trees = samplePoissonDisc(cells, cells, spacing.tree, random);
  const small = samplePoissonDisc(cells, cells, spacing.small, random);
  const count = (trees.length + small.length) / 2;
  const props: PropSet = {
    count,
    form: new Uint8Array(count),
    phase: new Float32Array(count),
    rotation: new Float32Array(count),
    scale: new Float32Array(count),
    types: new Uint8Array(count),
    x: new Float32Array(count),
    y: new Float32Array(count),
    z: new Float32Array(count)
  };
  let index = 0;
  const place = (points: number[], pickType: () => number) => {
    for (let point = 0; point < points.length; point += 2) {
      const x = points[point]!, z = points[point + 1]!;
      props.types[index] = pickType();
      props.x[index] = x;
      props.z[index] = z;
      props.y[index] = heights[Math.floor(z) * side + Math.floor(x)]!;
      props.rotation[index] = random() * Math.PI * 2;
      props.scale[index] = 0.8 + random() * 0.5;
      props.phase[index] = random() * Math.PI * 2;
      index += 1;
    }
  };
  place(trees, () => PROP.broadleafTree);
  place(small, () => SMALL_PROP_TYPES[Math.floor(random() * SMALL_PROP_TYPES.length)]!);
  return props;
};

const pickFloats = (array: Float32Array, kept: number[]) => Float32Array.from(kept, (source) => array[source]!);
const pickBytes = (array: Uint8Array, kept: number[]) => Uint8Array.from(kept, (source) => array[source]!);

/** Props on land only: the sampled points over open water are dropped, ids stay in order. */
const keepLandProps = (props: PropSet): PropSet => {
  const kept: number[] = [];
  for (let index = 0; index < props.count; index += 1) if (props.y[index]! > SEA_LEVEL) kept.push(index);
  return {
    count: kept.length,
    form: pickBytes(props.form, kept),
    phase: pickFloats(props.phase, kept),
    rotation: pickFloats(props.rotation, kept),
    scale: pickFloats(props.scale, kept),
    types: pickBytes(props.types, kept),
    x: pickFloats(props.x, kept),
    y: pickFloats(props.y, kept),
    z: pickFloats(props.z, kept)
  };
};

/**
 * A complete, deterministic `WorldData` of any side (the codec and limit tests use 1024 with a
 * dense forest): every layer has its correct length, props come from Poisson disc sampling and
 * the world is never produced by `generateWorld` (which takes ~30 s at 1024).
 */
export const createSyntheticDenseWorld = (options: SyntheticDenseWorldOptions): WorldData => {
  const { cells, seed, treeSpacing } = options;
  const spacing = { small: options.smallPropSpacing ?? DEFAULT_SMALL_PROP_SPACING, tree: treeSpacing };
  const random = createRandom(seed);
  const vertexCount = (cells + 1) * (cells + 1);
  const cellCount = cells * cells;
  const heights = createHeights(cells, random);
  const waterSurface = new Float32Array(vertexCount).fill(SEA_LEVEL);
  const props = keepLandProps(createProps(cells, spacing, heights, random));
  return {
    ambientOcclusion: new Uint8Array(vertexCount).fill(200),
    blocking: new Uint8Array(cellCount).fill(BLOCKING.free),
    buildCap: new Uint8Array(cellCount).fill(BUILD.large),
    buildClass: new Uint8Array(cellCount).fill(BUILD.large),
    cellsX: cells,
    cellsZ: cells,
    coastDistance: new Float32Array(vertexCount),
    flow: new Float32Array(vertexCount * 2),
    fog: new Uint8Array(cellCount).fill(FOG.hidden),
    heightLevels: new Uint8Array(vertexCount),
    heights,
    mineZone: new Uint16Array(cellCount).fill(NO_MINE_ZONE),
    mineZones: [],
    moisture: new Uint8Array(vertexCount).fill(120),
    normals: new Float32Array(vertexCount * 3),
    oreAmount: new Uint8Array(cellCount),
    props,
    riverDistance: new Float32Array(vertexCount).fill(1000),
    seaLevel: SEA_LEVEL,
    sector: new Uint16Array(cellCount),
    seed,
    slopeClass: new Uint8Array(cellCount),
    splat: createSplat(heights, random),
    start: { x: cells / 2, z: cells / 2 },
    sun: { azimuthX: 0.6, azimuthZ: 0.8, elevation: 0.9 },
    sunShadow: new Uint8Array(vertexCount),
    themeWeights: createThemeWeights(vertexCount),
    walkCost: new Uint8Array(cellCount).fill(10),
    waterDepth: createWaterDepth(heights, waterSurface),
    waterSurface,
    waterfalls: [],
    wetRock: new Uint8Array(vertexCount)
  };
};
