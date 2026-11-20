import {
  createNoiseTexture,
  NOISE_LATTICE,
  NOISE_PERIOD,
  NOISE_SEED,
  NOISE_TEXTURE_SIZE
} from "../../../../render-common/noise-textures";

/** CPU reference of the nearest/repeat noise texture used by `NOISE_GLSL`. */
export const NOISE_REFERENCE_PIXELS = createNoiseTexture(NOISE_SEED);

const wrap = (value: number) => ((value % 1) + 1) % 1;

export const sampleNoiseTexture = (point: readonly [number, number],
  pixels: Uint8Array = NOISE_REFERENCE_PIXELS) => {
  const u = wrap(point[0] / NOISE_LATTICE);
  const v = wrap(point[1] / NOISE_LATTICE);
  const x = Math.min(NOISE_TEXTURE_SIZE - 1, Math.floor(u * NOISE_TEXTURE_SIZE));
  const y = Math.min(NOISE_TEXTURE_SIZE - 1, Math.floor(v * NOISE_TEXTURE_SIZE));
  const offset = (y * NOISE_TEXTURE_SIZE + x) * 4;
  return [pixels[offset]! / 255, pixels[offset + 1]! / 255, pixels[offset + 2]! / 255,
    pixels[offset + 3]! / 255] as const;
};

export const valueNoise = (x: number, y: number) => sampleNoiseTexture([x, y])[0];
export const valueNoise4 = (x: number, y: number) => sampleNoiseTexture([x, y]);

/** The first two fbm3 octaves (r, then g at the second lattice), unweighted by the third. */
export const fbm2Octaves = (x: number, y: number) =>
  sampleNoiseTexture([x, y])[0] * 0.5 +
  sampleNoiseTexture([x * 2.03 + 17.1, y * 2.03 + 17.1])[1] * 0.3;

/** `NOISE_GLSL` fbm3: one channel per octave (r, g, b), as the GLSL samples them. */
export const fbm3 = (x: number, y: number) =>
  fbm2Octaves(x, y) + sampleNoiseTexture([x * 4.01 + 3.7, y * 4.01 + 3.7])[2] * 0.2;

export const NOISE_REFERENCE = { lattice: NOISE_LATTICE, period: NOISE_PERIOD, seed: NOISE_SEED,
  size: NOISE_TEXTURE_SIZE } as const;
