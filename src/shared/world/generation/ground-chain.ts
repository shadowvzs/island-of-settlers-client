import type { GridSize } from "../grid-geometry";
import {
  type BufferSoil,
  getDominantMaterial,
  getLeadingShare,
  GREEN_GROUNDS,
  type LeadRule,
  readSplatWeights,
  shiftGreenToBuffer,
  writeSplatWeights} from "../ground-buffer";
import { createFbm, type Noise2,smoothstep } from "../noise";
import { deriveSeed } from "../rng";
import { MATERIAL, MATERIAL_COUNT, PROP, type PropSet } from "../world-data";
import { computeDistanceField } from "./distance-field";
import type { ThemeSampler } from "./theme-field";

/**
 * Reach (cells) of a band, jittered by noise between these: at least the diagonal neighbours of
 * a source, in places one vertex further.
 */
const BAND_REACH: [number, number] = [1.42, 2.1];
/**
 * Lead (splat bytes, of 255) the buffer gets over every green material, jittered by noise: the
 * buffer only just dominates, the rest stays green, so the data keeps its meadow and the terrain
 * shader draws the narrow, noise shaped visible edge inside the cell.
 */
const LEAD: [number, number] = [14, 40];
/**
 * Next to rock the buffer is pebbly soil: soil with a pebble share (pebbles among the soil in
 * the shader), so it needs no soil ring of its own.
 */
const PEBBLE_SHARE = 0.25;
/** Noise frequency per cell: reach and lead change every few cells. */
const BAND_FREQUENCY = 0.21;
/** Noise offset of the soil band, so it does not follow the rock band. */
const SOIL_NOISE_OFFSET = 37.3;
/** Extra patch reach (cells) around a rock prop beyond its own cell corners, jittered. */
const PATCH_REACH: [number, number] = [0.6, 1.5];
const PATCH_FREQUENCY = 0.9;
const PATCH_NOISE_OFFSET = 71.9;
const ROCK_PROPS = new Set<number>([PROP.smallRock, PROP.largeRock]);
const SOILS = [MATERIAL.dirt, MATERIAL.sand, MATERIAL.snow];
/**
 * Next to pebbles a soil must lead and top the pebbles and the rock too: a vertex turning pebble
 * or rock dominant here would need a buffer ring of its own.
 */
const SOIL_RULE: LeadRule = { leaders: SOILS, rivals: [MATERIAL.gravel, MATERIAL.rock] };
/** Next to rock and stones soil or pebbles may lead (pebbles get their soil ring later). */
const BARE_RULE: LeadRule = { leaders: [...SOILS, MATERIAL.gravel], rivals: [MATERIAL.rock] };

/** Next to rock: pebbly soil; next to pebbles and stones: soil. */
const ROCK_BUFFER: BufferShift = { pebbles: PEBBLE_SHARE, rule: BARE_RULE };
const SOIL_BUFFER: BufferShift = { pebbles: 0, rule: SOIL_RULE };
const STONE_BUFFER: BufferShift = { pebbles: 0, rule: BARE_RULE };

const isRockDominant = (splat: Uint8Array, vertex: number) =>
  getDominantMaterial(splat, vertex) === MATERIAL.rock;

const isGravelDominant = (splat: Uint8Array, vertex: number) =>
  getDominantMaterial(splat, vertex) === MATERIAL.gravel;

const lerpRange = ([from, to]: [number, number], amount: number) => from + (to - from) * amount;

/** Per material share of the moved green: the theme soil, and pebbles next to rock. */
const createGains = (soil: BufferSoil, pebbles: number) => {
  const gains = new Float32Array(MATERIAL_COUNT);
  gains[MATERIAL.gravel] = pebbles;
  gains[MATERIAL.dirt] = soil.dirt * (1 - pebbles);
  gains[MATERIAL.sand] = soil.sand * (1 - pebbles);
  gains[MATERIAL.snow] = soil.snow * (1 - pebbles);
  return gains;
};

interface BufferShift {
  /** Pebble part of the moved green. */
  pebbles: number;
  rule: LeadRule;
}

/** Moves the smallest green share that lets a leader lead by `lead` (in place). */
const shiftToLead = (
  weights: Float32Array,
  soil: BufferSoil,
  { pebbles, rule }: BufferShift,
  lead: number
) => {
  const share = getLeadingShare(weights, createGains(soil, pebbles), rule, lead);
  if (share <= 0) return;
  const gravel = share * pebbles;
  shiftGreenToBuffer(weights, gravel, (share - gravel) / (1 - gravel), soil);
};

interface BandPass {
  buffer: BufferShift;
  distances: Float32Array;
  noiseOffset: number;
}

/** Gives the buffer the lead on every vertex within the band's jittered reach (in place). */
const spreadBand = (
  grid: GridSize,
  ground: { splat: Uint8Array; theme: ThemeSampler },
  noise: Noise2,
  pass: BandPass
) => {
  const { splat, theme } = ground;
  const weights = new Float32Array(MATERIAL_COUNT);
  const stride = grid.cellsX + 1;
  pass.distances.forEach((distance, vertex) => {
    if (distance <= 0 || distance > BAND_REACH[1]) return;
    const x = (vertex % stride) * BAND_FREQUENCY + pass.noiseOffset;
    const z = Math.floor(vertex / stride) * BAND_FREQUENCY;
    const jitter = smoothstep(-0.45, 0.45, noise(x, z));
    if (distance > lerpRange(BAND_REACH, jitter)) return;
    readSplatWeights(splat, vertex, weights);
    const lead = lerpRange(LEAD, smoothstep(-0.45, 0.45, noise(z + 5.7, x)));
    shiftToLead(weights, theme.atVertex(vertex).rockBuffer, pass.buffer, lead);
    writeSplatWeights(splat, vertex, weights);
  });
};

const createBandNoise = (seed: number) =>
  createFbm(deriveSeed(seed, "ground-chain"), { octaves: 2 });

type Ground = { splat: Uint8Array; theme: ThemeSampler };

/** The green neighbours of rock become pebbly soil. */
const spreadRockBand = (grid: GridSize, ground: Ground, noise: Noise2) =>
  spreadBand(grid, ground, noise, {
    buffer: ROCK_BUFFER,
    distances: computeDistanceField(grid, (vertex) => isRockDominant(ground.splat, vertex)),
    noiseOffset: 0
  });

/** The green neighbours of pebble dominant ground become the theme's soil (dirt, sand, snow). */
const spreadSoilBand = (grid: GridSize, ground: Ground, noise: Noise2) =>
  spreadBand(grid, ground, noise, {
    buffer: SOIL_BUFFER,
    distances: computeDistanceField(grid, (vertex) => isGravelDominant(ground.splat, vertex)),
    noiseOffset: SOIL_NOISE_OFFSET
  });

/** Rounds of both bands at most: a vertex can turn rock or pebble dominant once its green left. */
const MAX_ROUNDS = 4;

/** True when a rock or pebble dominant vertex has a green dominant 8-neighbour. */
const hasChainBreak = (grid: GridSize, splat: Uint8Array) => {
  const stride = grid.cellsX + 1;
  for (let z = 0; z <= grid.cellsZ; z += 1) {
    for (let x = 0; x <= grid.cellsX; x += 1) {
      const material = getDominantMaterial(splat, z * stride + x);
      if (material !== MATERIAL.rock && material !== MATERIAL.gravel) continue;
      if (hasGreenNeighbour(grid, splat, x, z)) return true;
    }
  }
  return false;
};

const hasGreenNeighbour = (grid: GridSize, splat: Uint8Array, x: number, z: number) => {
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx > grid.cellsX || nz > grid.cellsZ) continue;
      if (GREEN_GROUNDS.includes(getDominantMaterial(splat, nz * (grid.cellsX + 1) + nx))) {
        return true;
      }
    }
  }
  return false;
};

/**
 * Runs the rock band then the soil band until the chain holds: a vertex whose green moved out
 * can turn rock or pebble dominant and need a ring of its own. The bands are idempotent where the
 * buffer leads already, so later rounds only touch the new spots.
 */
const settleChain = (grid: GridSize, ground: Ground, noise: Noise2) => {
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    spreadRockBand(grid, ground, noise);
    spreadSoilBand(grid, ground, noise);
    if (!hasChainBreak(grid, ground.splat)) return;
  }
};

/**
 * The ground chain on the splat (in place): the green neighbours of rock become pebbly soil,
 * the green neighbours of pebble dominant ground (stony patches) the theme's soil (dirt, sand,
 * snow). The buffer only just leads (most of the green stays), within a noise jittered reach of
 * 1.42 .. 2.1 cells, so no green dominant vertex touches rock or pebbles.
 */
export const applyGroundChain = (
  grid: GridSize,
  seed: number,
  splat: Uint8Array,
  theme: ThemeSampler
) => settleChain(grid, { splat, theme }, createBandNoise(seed));

interface Point {
  x: number;
  z: number;
}

/** A vertex of the stone's own cell (its neighbours), or one within the jittered patch reach. */
const isInPatch = (stone: Point, vertexX: number, vertexZ: number, noise: Noise2) => {
  if (Math.abs(vertexX - stone.x) < 1 && Math.abs(vertexZ - stone.z) < 1) return true;
  const jitter = smoothstep(
    -0.45,
    0.45,
    noise(vertexX * PATCH_FREQUENCY + PATCH_NOISE_OFFSET, vertexZ * PATCH_FREQUENCY)
  );
  return Math.hypot(vertexX - stone.x, vertexZ - stone.z) <= lerpRange(PATCH_REACH, jitter);
};

/** Gives the soil the lead around one stone (in place). */
const stampPatch = (
  grid: GridSize,
  ground: { splat: Uint8Array; theme: ThemeSampler },
  noise: Noise2,
  stone: Point
) => {
  const weights = new Float32Array(MATERIAL_COUNT);
  const stride = grid.cellsX + 1;
  const reach = PATCH_REACH[1];
  for (let z = Math.max(0, Math.ceil(stone.z - reach)); z <= stone.z + reach; z += 1) {
    for (let x = Math.max(0, Math.ceil(stone.x - reach)); x <= stone.x + reach; x += 1) {
      if (x > grid.cellsX || z > grid.cellsZ || !isInPatch(stone, x, z, noise)) continue;
      const vertex = z * stride + x;
      readSplatWeights(ground.splat, vertex, weights);
      shiftToLead(weights, ground.theme.atVertex(vertex).rockBuffer, STONE_BUFFER, LEAD[1]);
      writeSplatWeights(ground.splat, vertex, weights);
    }
  }
};

/** Soil patches around the stones, then the chain settles again (in place). */
const patchStones = (
  grid: GridSize,
  seed: number,
  ground: { splat: Uint8Array; theme: ThemeSampler },
  stones: readonly Point[]
) => {
  const noise = createBandNoise(seed);
  for (const stone of stones) stampPatch(grid, ground, noise, stone);
  settleChain(grid, ground, noise);
};

/** The rock props (meadow stones) of the set from `first` on, as stone points. */
const listRockProps = (props: PropSet, first = 0) => {
  const stones: Point[] = [];
  for (let index = first; index < props.count; index += 1)
    if (ROCK_PROPS.has(props.types[index]!)) stones.push({ x: props.x[index]!, z: props.z[index]! });
  return stones;
};

/**
 * Rock props (meadow stones) lie on soil (in place): the soil leads on the corners of the
 * stone's cell and on a noise shaped patch around it, so a stone never borders grass directly.
 * A patch can leave a minor pebble or rock share dominant, so the chain settles again.
 */
export const addRockPropPatches = (
  grid: GridSize,
  seed: number,
  ground: { props: PropSet; splat: Uint8Array },
  theme: ThemeSampler
) => patchStones(grid, seed, { splat: ground.splat, theme }, listRockProps(ground.props));

/** Rock props added after the vegetation pass (props from `first` on) lie on soil too. */
export const addLateRockPropPatches = (
  grid: GridSize,
  seed: number,
  ground: { first: number; props: PropSet; splat: Uint8Array },
  theme: ThemeSampler
) => {
  const stones = listRockProps(ground.props, ground.first);
  if (stones.length > 0) patchStones(grid, seed, { splat: ground.splat, theme }, stones);
};
