import { createPermutation } from "../../shared/world/noise";

const GRADIENT_X = new Float32Array(16);
const GRADIENT_Y = new Float32Array(16);
for (let index = 0; index < 16; index += 1) {
  GRADIENT_X[index] = Math.cos((index / 16) * Math.PI * 2);
  GRADIENT_Y[index] = Math.sin((index / 16) * Math.PI * 2);
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

const wrap = (value: number, period: number) => ((value % period) + period) % period;

/** Tileable noise for textures: u, v in 0..1 repeat seamlessly. */
export interface PeriodicNoise {
  /** Gradient noise with `period` lattice cells per tile, about -1..1. */
  gradient(u: number, v: number, period: number): number;
  /** Sum of octaves starting at `period` cells, about -1..1. */
  fbm(u: number, v: number, period: number, octaves: number): number;
  /** Worley (cellular) distances to the nearest and second nearest feature point. */
  worley(u: number, v: number, period: number): WorleySample;
}

interface WorleySample {
  /** Distance to the nearest point, in cell units. */
  nearest: number;
  /** Random 0..1 value of the nearest cell (stone / leaf colour). */
  nearestId: number;
  /** Offset from the nearest feature point to the sample, in cell units (plate facets). */
  offsetX: number;
  offsetY: number;
  second: number;
}

export const createPeriodicNoise = (seed: number): PeriodicNoise => {
  const permutation = createPermutation(seed);
  const hash = (x: number, y: number) => permutation[(permutation[x & 255]! + y) & 255]!;
  const corner = (ix: number, iy: number, dx: number, dy: number) => {
    const gradient = hash(ix, iy) & 15;
    return GRADIENT_X[gradient]! * dx + GRADIENT_Y[gradient]! * dy;
  };

  const gradient = (u: number, v: number, period: number) => {
    const x = u * period;
    const y = v * period;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const ix0 = wrap(x0, period);
    const iy0 = wrap(y0, period);
    const ix1 = wrap(x0 + 1, period);
    const iy1 = wrap(y0 + 1, period);
    const sx = fade(fx);
    const sy = fade(fy);
    const top = corner(ix0, iy0, fx, fy) * (1 - sx) + corner(ix1, iy0, fx - 1, fy) * sx;
    const bottom = corner(ix0, iy1, fx, fy - 1) * (1 - sx) + corner(ix1, iy1, fx - 1, fy - 1) * sx;
    return (top * (1 - sy) + bottom * sy) * 1.41;
  };

  const fbm = (u: number, v: number, period: number, octaves: number) => {
    let sum = 0;
    let amplitude = 1;
    let norm = 0;
    let cells = period;
    for (let octave = 0; octave < octaves; octave += 1) {
      sum += gradient(u, v, cells) * amplitude;
      norm += amplitude;
      amplitude *= 0.5;
      cells *= 2;
    }
    return sum / norm;
  };

  const worley = (u: number, v: number, period: number): WorleySample => {
    const x = u * period;
    const y = v * period;
    const cellX = Math.floor(x);
    const cellY = Math.floor(y);
    let nearest = 9;
    let second = 9;
    let nearestId = 0;
    let offsetX = 0;
    let offsetY = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const ix = wrap(cellX + dx, period);
        const iy = wrap(cellY + dy, period);
        const id = hash(ix, iy);
        const pointX = cellX + dx + (hash(ix + 17, iy + 31) / 255) * 0.9 + 0.05;
        const pointY = cellY + dy + (hash(ix + 59, iy + 7) / 255) * 0.9 + 0.05;
        const distance = Math.hypot(pointX - x, pointY - y);
        if (distance < nearest) {
          second = nearest;
          nearest = distance;
          nearestId = id / 255;
          offsetX = x - pointX;
          offsetY = y - pointY;
        } else if (distance < second) {
          second = distance;
        }
      }
    }
    return { nearest, nearestId, offsetX, offsetY, second };
  };

  return { fbm, gradient, worley };
};
