import { toByte } from "./color";
import { createPeriodicNoise } from "./materials/periodic-noise";

export const NOISE_TEXTURE_SIZE = 256;
export const NOISE_PERIOD = 32;
/** Shader lattice period (`NOISE_GLSL` samples the texture at p / 32). */
export const NOISE_LATTICE = NOISE_PERIOD;
export const NOISE_SEED = 77;
const RIPPLE_PERIOD = 8;

/**
 * Tileable value-like noise in 4 independent channels (lattice period 32 per tile). Shaders
 * fetch it instead of hashing: one texture read replaces about 20 ALU operations, which matters
 * most on integrated GPUs.
 */
export const createNoiseTexture = (seed: number) => {
  const channels = [0, 1, 2, 3].map((channel) => createPeriodicNoise(seed + channel * 7717));
  const pixels = new Uint8Array(NOISE_TEXTURE_SIZE * NOISE_TEXTURE_SIZE * 4);
  for (let y = 0; y < NOISE_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < NOISE_TEXTURE_SIZE; x += 1) {
      const u = x / NOISE_TEXTURE_SIZE;
      const v = y / NOISE_TEXTURE_SIZE;
      const offset = (y * NOISE_TEXTURE_SIZE + x) * 4;
      channels.forEach((noise, channel) => {
        pixels[offset + channel] = toByte(noise.gradient(u, v, NOISE_PERIOD) * 0.7 + 0.5);
      });
    }
  }
  return pixels;
};

/** Ripple height for the water normal map: two octaves of tileable noise. */
const createRippleHeight = (seed: number) => {
  const noise = createPeriodicNoise(seed);
  return (u: number, v: number) => noise.fbm(u, v, RIPPLE_PERIOD, 3);
};

/**
 * Tileable water normals: RG = normal x/z of ripple field A, BA = of field B. Two scrolling
 * lookups replace six procedural height evaluations per pixel.
 */
export const createWaterNormalTexture = (seed: number) => {
  const fields = [createRippleHeight(seed), createRippleHeight(seed + 99)];
  const pixels = new Uint8Array(NOISE_TEXTURE_SIZE * NOISE_TEXTURE_SIZE * 4);
  const step = 1 / NOISE_TEXTURE_SIZE;
  for (let y = 0; y < NOISE_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < NOISE_TEXTURE_SIZE; x += 1) {
      const u = x * step;
      const v = y * step;
      const offset = (y * NOISE_TEXTURE_SIZE + x) * 4;
      fields.forEach((height, field) => {
        const dx = (height(u + step, v) - height(u - step, v)) * 6;
        const dz = (height(u, v + step) - height(u, v - step)) * 6;
        pixels[offset + field * 2] = toByte(-dx * 0.5 + 0.5);
        pixels[offset + field * 2 + 1] = toByte(-dz * 0.5 + 0.5);
      });
    }
  }
  return pixels;
};
