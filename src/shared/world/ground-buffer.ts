import { MATERIAL, MATERIAL_COUNT } from "./world-data";

/**
 * The ground chain: rock -> pebbles (gravel) -> soil (dirt, or the theme's sand / snow) -> green
 * ground. Green grounds never border rock or pebbles directly.
 */
export const GREEN_GROUNDS: readonly number[] = [
  MATERIAL.grass,
  MATERIAL.lushGrass,
  MATERIAL.forestFloor
];

/** Soil between the pebble band and the green ground, as material shares (sum 1). */
export interface BufferSoil {
  dirt: number;
  sand: number;
  snow: number;
}


/**
 * Moves the green share of splat weights (one value per material, any scale) into the rock
 * buffer: `gravel` (0..1) of it into pebbles, then `soil` (0..1) of the rest into the soil mix.
 * The total weight is kept.
 */
export const shiftGreenToBuffer = (
  weights: Float32Array,
  gravel: number,
  soil: number,
  mix: BufferSoil
) => {
  if (gravel <= 0 && soil <= 0) return;
  const kept = (1 - gravel) * (1 - soil);
  let green = 0;
  for (const material of GREEN_GROUNDS) {
    green += weights[material]!;
    weights[material] = weights[material]! * kept;
  }
  if (green <= 0) return;
  const toGravel = green * gravel;
  const toSoil = (green - toGravel) * soil;
  weights[MATERIAL.gravel] = weights[MATERIAL.gravel]! + toGravel;
  weights[MATERIAL.dirt] = weights[MATERIAL.dirt]! + toSoil * mix.dirt;
  weights[MATERIAL.sand] = weights[MATERIAL.sand]! + toSoil * mix.sand;
  weights[MATERIAL.snow] = weights[MATERIAL.snow]! + toSoil * mix.snow;
};

/** Which grounds may lead after a shift, and which bare grounds they must also beat. */
export interface LeadRule {
  leaders: readonly number[];
  /** Bare grounds the leader must top too (they keep their weight in the shift). */
  rivals: readonly number[];
}

/** Share a leader needs to top a fixed rival weight by `lead` (Infinity when it gains none). */
const getShareOverRival = (gain: number, missing: number) => {
  if (missing <= 0) return 0;
  return gain > 0 ? missing / gain : Infinity;
};

/**
 * Smallest share 0..1 of the green ground that, moved by `gains` (per material: its part of the
 * moved weight), lets one of the rule's leaders top every green material and every rival by
 * `lead` (weight units). 0 when one leads already; 1 when no share is enough.
 */
export const getLeadingShare = (
  weights: Float32Array,
  gains: Float32Array,
  rule: LeadRule,
  lead: number
) => {
  let green = 0;
  let greenMax = 0;
  for (const material of GREEN_GROUNDS) {
    green += weights[material]!;
    greenMax = Math.max(greenMax, weights[material]!);
  }
  if (green <= 0) return 0;
  const rival = rule.rivals.reduce((highest, material) => Math.max(highest, weights[material]!), 0);
  let share = 1;
  for (const material of rule.leaders) {
    const gain = green * gains[material]!;
    const overGreen = (greenMax + lead - weights[material]!) / (gain + greenMax);
    const overRival = getShareOverRival(gain, rival + lead - weights[material]!);
    share = Math.min(share, Math.max(0, overGreen, overRival));
  }
  return share;
};

/** Reads a vertex's splat bytes into `weights` (0..255 per material). */
export const readSplatWeights = (splat: Uint8Array, vertex: number, weights: Float32Array) => {
  for (let material = 0; material < MATERIAL_COUNT; material += 1) {
    weights[material] = splat[vertex * MATERIAL_COUNT + material]!;
  }
};

/** Writes normalised weights as bytes (sum 255; grass when all are 0). */
export const writeSplatWeights = (splat: Uint8Array, vertex: number, weights: Float32Array) => {
  let total = 0;
  for (let material = 0; material < MATERIAL_COUNT; material += 1) total += weights[material]!;
  const scale = total > 0 ? 255 / total : 0;
  for (let material = 0; material < MATERIAL_COUNT; material += 1) {
    splat[vertex * MATERIAL_COUNT + material] = Math.round(weights[material]! * scale);
  }
  if (total === 0) splat[vertex * MATERIAL_COUNT + MATERIAL.grass] = 255;
};

/** The material with the highest weight at a vertex (the first on a tie). */
export const getDominantMaterial = (splat: Uint8Array, vertex: number) => {
  const base = vertex * MATERIAL_COUNT;
  let dominant = 0;
  for (let material = 1; material < MATERIAL_COUNT; material += 1) {
    if (splat[base + material]! > splat[base + dominant]!) dominant = material;
  }
  return dominant;
};
