import { DMath } from "../../shared/math/deterministic-math";
import { sampleBilinear } from "../../shared/world/grid-geometry";
import { createRandom, deriveSeed, type Random } from "../../shared/world/rng";
import { MATERIAL, MATERIAL_COUNT, type WorldData } from "../../shared/world/world-data";
import { COVER, getMeshId, getVariantCount } from "./prop-mesh-layout";
import { OPEN_SHELL_WEIGHTS } from "./shells/open-shells";
import { SEA_SNAIL_WEIGHTS } from "./shells/spiral-shells";

/**
 * Where the shore shells lie (placement only, no meshes): deterministic from the world seed with
 * DMath, so the settlement simulation (shell collecting) and the renderer agree on every shell.
 */

/**
 * Bands (cells from the water) where shells lie: across the whole beach width on sand (the dry
 * sand reads best), along the waterline on grassy river and lake banks.
 */
const BEACH_BAND: [number, number] = [0.25, 4.5];
const BANK_BAND: [number, number] = [0.25, 1.4];
/** The wet swash band next to the water keeps only this share of its shells (the minority). */
const WET_EDGE = 0.9;
const WET_SHARE = 0.35;
/**
 * Chance per beach candidate (two per sand cell), cumulative order: sea stars, seashells, sea-snail
 * shells; about one whole shell per two cells of open beach, which brings the island total back
 * to the first set's count despite the grass margin. Snail shells per grassy bank cell.
 */
const SEA_STAR_CHANCE = 0.05;
const SEASHELL_CHANCE = 0.17;
const SEA_SNAIL_CHANCE = 0.1;
const OPEN_SHELL_CHANCE = 0.05;
const SNAIL_SHELL_CHANCE = 0.03;
const SAND_SHARE = 0.5;
const BEACH_KINDS: [number, number][] = [
  [COVER.seaStar, SEA_STAR_CHANCE],
  [COVER.seashell, SEASHELL_CHANCE],
  [COVER.seaSnailShell, SEA_SNAIL_CHANCE],
  [COVER.openShell, OPEN_SHELL_CHANCE]
];
/** Beach shells keep this much sand (cells) between them and green ground. */
const GRASS_MARGIN = 0.6;
const MARGIN_DIRECTIONS = 8;
/** Per-instance colour variation (multiplier, warm or cool). */
const TINT_SPREAD = 0.08;
/**
 * Bivalve colours (tints of their cream base): cream-tan banded, olive-brown, grey-blue, orange, coral
 * pink, lilac, yellow; all stay clear of the sand colour once banded by the shader.
 */
const BIVALVE_TINTS: [number, number, number][] = [
  [1, 0.93, 0.8],
  [0.84, 0.72, 0.5],
  [0.72, 0.82, 1],
  [1, 0.6, 0.28],
  [1, 0.52, 0.58],
  [0.78, 0.6, 1],
  [1, 0.86, 0.32]
];
const BIVALVE_KINDS = new Set<number>([COVER.seashell, COVER.openShell]);

const readSand = (world: WorldData, x: number, z: number) => {
  const vertex = Math.round(z) * (world.cellsX + 1) + Math.round(x);
  return world.splat[vertex * MATERIAL_COUNT + MATERIAL.sand]! / 255;
};

/** No dry green ground around the spot within the grass margin (water is fine). */
const hasSandMargin = (world: WorldData, x: number, z: number) => {
  for (let step = 0; step < MARGIN_DIRECTIONS; step += 1) {
    const angle = (step / MARGIN_DIRECTIONS) * Math.PI * 2;
    const sampleX = Math.min(world.cellsX, Math.max(0, x + DMath.cos(angle) * GRASS_MARGIN));
    const sampleZ = Math.min(world.cellsZ, Math.max(0, z + DMath.sin(angle) * GRASS_MARGIN));
    const isDry = sampleBilinear(world, world.waterDepth, sampleX, sampleZ) <= 0;
    if (isDry && readSandSmooth(world, sampleX, sampleZ) < SAND_SHARE) return false;
  }
  return true;
};

/** Sand weight between the four vertices around a point (smooth, for the grass margin). */
const readSandSmooth = (world: WorldData, x: number, z: number) => {
  const left = Math.min(world.cellsX - 1, Math.floor(x)), top = Math.min(world.cellsZ - 1, Math.floor(z));
  const fx = x - left, fz = z - top;
  const at = (vx: number, vz: number) => readSand(world, vx, vz);
  const near = at(left, top) * (1 - fx) + at(left + 1, top) * fx;
  const far = at(left, top + 1) * (1 - fx) + at(left + 1, top + 1) * fx;
  return near * (1 - fz) + far * fz;
};

const isInside = (distance: number, band: [number, number]) => distance >= band[0] && distance <= band[1];

const chooseBeachKind = (roll: number) => {
  let total = 0;
  for (const [kind, chance] of BEACH_KINDS) {
    total += chance;
    if (roll < total) return kind;
  }
  return null;
};

/** Beach candidates per cell (the first one may also be a bank snail shell). */
const CANDIDATES_PER_CELL = 2;
/** Two shells of one cell keep at least this distance (cells). */
const MIN_SPACING = 0.4;

/**
 * Shell or sea star for a dry spot near the water, or null when nothing lies there; `withBank`
 * also allows a snail shell on a grassy bank.
 */
const chooseShell = (world: WorldData, x: number, z: number, random: Random, withBank: boolean) => {
  if (sampleBilinear(world, world.waterDepth, x, z) > 0) return null;
  const distance = sampleBilinear(world, world.coastDistance, x, z);
  const roll = random();
  if (readSand(world, x, z) < SAND_SHARE) {
    const onBank = withBank && isInside(distance, BANK_BAND) && roll < SNAIL_SHELL_CHANCE;
    return onBank ? COVER.snailShell : null;
  }
  if (!isInside(distance, BEACH_BAND)) return null;
  const kind = chooseBeachKind(distance < WET_EDGE ? roll / WET_SHARE : roll);
  return kind !== null && hasSandMargin(world, x, z) ? kind : null;
};

const createTint = (random: Random, kind: number): [number, number, number] => {
  const warmth = (random() * 2 - 1) * TINT_SPREAD;
  const light = 1 + (random() * 2 - 1) * TINT_SPREAD * 0.5;
  const jitter: [number, number, number] = [light * (1 + warmth), light, light * (1 - warmth)];
  if (!BIVALVE_KINDS.has(kind)) return jitter;
  const colour = BIVALVE_TINTS[Math.floor(random() * BIVALVE_TINTS.length)]!;
  return [colour[0] * jitter[0], colour[1] * jitter[1], colour[2] * jitter[2]];
};

/** Weighted pick (by `weights`) for a 0..1 roll. */
const pickWeighted = (weights: readonly number[], roll: number) => {
  let left = roll * weights.reduce((total, weight) => total + weight, 0);
  for (let index = 0; index < weights.length; index += 1) {
    left -= weights[index]!;
    if (left < 0) return index;
  }
  return weights.length - 1;
};

/** Variant weights: rare sea snails rarer, about 30 % of open shells with a pearl. */
const VARIANT_WEIGHTS: Partial<Record<number, readonly number[]>> = {
  [COVER.openShell]: OPEN_SHELL_WEIGHTS,
  [COVER.seaSnailShell]: SEA_SNAIL_WEIGHTS
};

/** Mesh variant: weighted where a kind has weights, otherwise uniform. */
const pickVariant = (kind: number, roll: number) => {
  const weights = VARIANT_WEIGHTS[kind];
  return weights ? pickWeighted(weights, roll) : Math.floor(roll * getVariantCount(kind));
};

/** One shell's placement: mesh (kind and variant), turn, size, colour and ground position. */
export interface ShoreShellSpot {
  meshId: number;
  rotation: number;
  scale: number;
  tint: [number, number, number];
  x: number;
  z: number;
}

const createSpot = (kind: number, x: number, z: number, random: Random): ShoreShellSpot => {
  const meshId = getMeshId(kind, pickVariant(kind, random()));
  const rotation = random() * Math.PI * 2;
  const scale = 0.85 + random() * 0.3;
  return { meshId, rotation, scale, tint: createTint(random, kind), x, z };
};

/** The shells of one cell: up to CANDIDATES_PER_CELL, spaced apart. */
const collectCellSpots = (world: WorldData, cellX: number, cellZ: number, random: Random, spots: ShoreShellSpot[]) => {
  let previous: ShoreShellSpot | null = null;
  for (let candidate = 0; candidate < CANDIDATES_PER_CELL; candidate += 1) {
    const x = cellX + random();
    const z = cellZ + random();
    const kind = chooseShell(world, x, z, random, candidate === 0);
    if (kind === null) continue;
    if (previous && DMath.hypot(previous.x - x, previous.z - z) < MIN_SPACING) continue;
    previous = createSpot(kind, x, z, random);
    spots.push(previous);
  }
};

const spotCache = new WeakMap<WorldData, ShoreShellSpot[]>();

/**
 * Every shore shell of the island in a stable order (the index is the shell's identity): whole
 * seashells, sea stars, sea-snail shells and open shells across sandy beaches (clear of the grass
 * edge), empty snail shells on river and lake banks. Two beach candidates per cell. Cached per world.
 */
export const listShoreShellSpots = (world: WorldData): readonly ShoreShellSpot[] => {
  const cached = spotCache.get(world);
  if (cached) return cached;
  const random = createRandom(deriveSeed(world.seed, "shore-shells"));
  const spots: ShoreShellSpot[] = [];
  for (let cellZ = 0; cellZ < world.cellsZ; cellZ += 1) {
    for (let cellX = 0; cellX < world.cellsX; cellX += 1) collectCellSpots(world, cellX, cellZ, random, spots);
  }
  spotCache.set(world, spots);
  return spots;
};

/** A dry beach spot where a collected shell may reappear (the beach rules, outside the wet band). */
export const isShoreRespawnSite = (world: WorldData, x: number, z: number) => {
  if (sampleBilinear(world, world.waterDepth, x, z) > 0 || readSand(world, x, z) < SAND_SHARE) return false;
  const distance = sampleBilinear(world, world.coastDistance, x, z);
  return distance >= WET_EDGE && distance <= BEACH_BAND[1] && hasSandMargin(world, x, z);
};
