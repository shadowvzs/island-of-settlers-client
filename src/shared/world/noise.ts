import { DMath } from "../math/deterministic-math";
import { createRandom } from "./rng";

/** A 2D noise function; simplex based noises return roughly -1..1. */
export type Noise2 = (x: number, y: number) => number;

const SKEW = 0.5 * (Math.sqrt(3) - 1);
const UNSKEW = (3 - Math.sqrt(3)) / 6;
const GRADIENTS = new Float32Array([1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 0, 1, 0, -1]);

/** 512 entry permutation table (256 shuffled values repeated) for lattice hashing. */
export const createPermutation = (seed: number) => {
  const random = createRandom(seed);
  const table = new Uint8Array(512);
  for (let index = 0; index < 256; index += 1) table[index] = index;
  for (let index = 255; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    const swap = table[index]!;
    table[index] = table[other]!;
    table[other] = swap;
  }
  for (let index = 0; index < 256; index += 1) table[index + 256] = table[index]!;
  return table;
};

const cornerContribution = (hash: number, x: number, y: number) => {
  const falloff = 0.5 - x * x - y * y;
  if (falloff < 0) return 0;
  const gradient = (hash & 7) * 2;
  const squared = falloff * falloff;
  return squared * squared * (GRADIENTS[gradient]! * x + GRADIENTS[gradient + 1]! * y);
};

/** Seeded 2D simplex noise (Gustavson), range about -1..1. */
export const createSimplexNoise = (seed: number): Noise2 => {
  const permutation = createPermutation(seed);
  return (x, y) => {
    const skew = (x + y) * SKEW;
    const cellX = Math.floor(x + skew);
    const cellY = Math.floor(y + skew);
    const unskew = (cellX + cellY) * UNSKEW;
    const x0 = x - (cellX - unskew);
    const y0 = y - (cellY - unskew);
    const stepX = x0 > y0 ? 1 : 0;
    const stepY = 1 - stepX;
    const hashX = cellX & 255;
    const hashY = cellY & 255;
    const hash0 = permutation[hashX + permutation[hashY]!]!;
    const hash1 = permutation[hashX + stepX + permutation[hashY + stepY]!]!;
    const hash2 = permutation[hashX + 1 + permutation[hashY + 1]!]!;
    const sum =
      cornerContribution(hash0, x0, y0) +
      cornerContribution(hash1, x0 - stepX + UNSKEW, y0 - stepY + UNSKEW) +
      cornerContribution(hash2, x0 - 1 + 2 * UNSKEW, y0 - 1 + 2 * UNSKEW);
    return 70 * sum;
  };
};

export interface FractalOptions {
  gain?: number;
  lacunarity?: number;
  octaves?: number;
}

/** Fractal Brownian motion over simplex octaves, normalised to about -1..1. */
export const createFbm = (seed: number, options: FractalOptions = {}): Noise2 => {
  const { gain = 0.5, lacunarity = 2, octaves = 5 } = options;
  const layers = Array.from({ length: octaves }, (_, index) =>
    createSimplexNoise(seed + index * 7919)
  );
  return (x, y) => {
    let sum = 0;
    let amplitude = 1;
    let norm = 0;
    let frequency = 1;
    for (const layer of layers) {
      sum += layer(x * frequency, y * frequency) * amplitude;
      norm += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / norm;
  };
};

/** Ridged multifractal (sharp crests), range 0..1. */
export const createRidgedNoise = (seed: number, octaves = 5): Noise2 => {
  const layers = Array.from({ length: octaves }, (_, index) =>
    createSimplexNoise(seed + index * 104729)
  );
  return (x, y) => {
    let sum = 0;
    let amplitude = 0.5;
    let norm = 0;
    let frequency = 1;
    let weight = 1;
    for (const layer of layers) {
      const ridge = 1 - Math.abs(layer(x * frequency, y * frequency));
      const signal = ridge * ridge * weight;
      weight = Math.min(1, signal * 2);
      sum += signal * amplitude;
      norm += amplitude;
      amplitude *= 0.5;
      frequency *= 2.1;
    }
    return sum / norm;
  };
};

/** Fractional part (0..1, also for negative values). */
export const fract = (value: number) => value - Math.floor(value);

/** Deterministic 0..1 value per lattice point: the classic fract(sin(dot)) hash, for baked texture grain. */
export const sinHash2 = (x: number, y: number) =>
  fract(DMath.sin(x * 127.1 + y * 311.7) * 43758.5453);

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;

type Triple = readonly [number, number, number];

/** Component-wise lerp of an RGB colour or a point. */
export const lerp3 = (from: Triple, to: Triple, amount: number): Triple => [
  from[0] + (to[0] - from[0]) * amount,
  from[1] + (to[1] - from[1]) * amount,
  from[2] + (to[2] - from[2]) * amount
];

/** Each component of an RGB colour or a point multiplied by `factor`. */
export const scale3 = (value: Triple, factor: number): Triple => [value[0] * factor, value[1] * factor, value[2] * factor];

/** Point `t` (0..1) along the quadratic Bezier curve from..control..to. */
export const quadraticBezier3 = (from: Triple, control: Triple, to: Triple, t: number) =>
  lerp3(lerp3(from, control, t), lerp3(control, to, t), t);

/** smoothstep(0, 1, value) without the edge arithmetic (per-frame pose easing). */
export const smoothstep01 = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

export const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
