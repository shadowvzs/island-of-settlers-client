import { hashTexel } from "../../../src/render-common/materials/tile-canvas";

const smooth = (value: number) => value * value * (3 - 2 * value);

/** Deterministic bilinear value noise, 0..1, lattice spacing 1. */
export const valueNoise = (x: number, y: number, salt: number) => {
  const ix = Math.floor(x), iy = Math.floor(y), sx = smooth(x - ix), sy = smooth(y - iy);
  const bottom = hashTexel(ix, iy, salt) * (1 - sx) + hashTexel(ix + 1, iy, salt) * sx;
  const top = hashTexel(ix, iy + 1, salt) * (1 - sx) + hashTexel(ix + 1, iy + 1, salt) * sx;
  return bottom * (1 - sy) + top * sy;
};

/** Three-octave value noise centred on zero (about -0.5..0.5). */
export const fractalNoise = (x: number, y: number, salt: number) =>
  (valueNoise(x, y, salt) * 0.57 + valueNoise(x * 2.03, y * 2.03, salt + 1) * 0.29 +
    valueNoise(x * 4.07, y * 4.07, salt + 2) * 0.14) - 0.5;

/**
 * Cellular distance F2 - F1 (0 on a cell border): the polygonal areoles that the finest leaf
 * veins enclose. Lattice spacing 1.
 */
export const cellBorderDistance = (x: number, y: number, salt: number) => {
  const ix = Math.floor(x), iy = Math.floor(y);
  let first = 9, second = 9;
  for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
    const cx = ix + dx, cy = iy + dy;
    const px = cx + 0.15 + hashTexel(cx, cy, salt) * 0.7, py = cy + 0.15 + hashTexel(cx, cy, salt + 7) * 0.7;
    const distance = Math.hypot(x - px, y - py);
    if (distance < first) { second = first; first = distance; } else if (distance < second) second = distance;
  }
  return second - first;
};

/** Gaussian ridge profile: 1 on the line, ~0 beyond twice the half-width. */
export const ridge = (distance: number, halfWidth: number) => Math.exp(-((distance / halfWidth) ** 2));

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const smoothstep = (edge0: number, edge1: number, value: number) =>
  smooth(clamp01((value - edge0) / (edge1 - edge0)));

export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * A vein line that survives mip filtering: a pale core at least `minimum` wide plus a darker
 * flank on both sides (the impressed groove), so the line keeps contrast after averaging.
 */
export const veinProfile = (distance: number, halfWidth: number, minimum: number) => {
  const width = Math.max(halfWidth, minimum), core = ridge(distance, width);
  return { core, flank: Math.max(0, ridge(distance, width * 2.4) - core) };
};
