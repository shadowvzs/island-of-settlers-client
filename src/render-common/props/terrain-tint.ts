import { smoothstep } from "../../shared/world/noise";
import { toByte } from "../color";
import { createPeriodicNoise } from "../materials/periodic-noise";
import { NOISE_PERIOD, NOISE_SEED } from "../noise-textures";

export type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];

export interface MeadowMacro {
  /** Broad ground brightness from the region's alpha channel. */
  brightness: number;
  /** Static meadow tint; rain, canopy and camera distance stay runtime inputs. */
  tint: Rgb;
}

const CHANNELS = [0, 1, 2, 3].map(channel => createPeriodicNoise(NOISE_SEED + channel * 7717));

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** One texel of the shared four-channel noise texture, quantised like the GPU upload. */
const sampleNoise4 = (x: number, z: number): Rgba => {
  const u = x / NOISE_PERIOD;
  const v = z / NOISE_PERIOD;
  return CHANNELS.map(noise => toByte(noise.gradient(u, v, NOISE_PERIOD) * 0.7 + 0.5) / 255) as Rgba;
};

const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
const mixRgb = (from: Rgb, to: Rgb, amount: number): Rgb => [
  mix(from[0], to[0], amount),
  mix(from[1], to[1], amount),
  mix(from[2], to[2], amount)
];

/**
 * CPU mirror of `meadowTint` minus the runtime rain, canopy and distance terms. `region` and
 * `patches` are the same four noise channels the ground shader samples.
 */
export const meadowMacroTint = (region: Rgba, patches: Rgba): Rgb => {
  const yellowGreen = smoothstep(0.36, 0.7, region[0]);
  const dry = smoothstep(0.58, 0.78, patches[2]) * smoothstep(0.42, 0.62, region[2]);
  const base = mixRgb([0.9, 1.0, 0.97], [1.07, 1.04, 0.84], yellowGreen);
  const brightness = mix(0.9, 1.08, region[1]) * mix(0.93, 1.07, patches[3]);
  const tinted = base.map(channel => channel * brightness) as Rgb;
  return mixRgb(tinted, [1.25, 1.08, 0.66], dry * 0.6);
};

/** Static meadow macro at a world coordinate; matches the shader's two relevant fetches. */
export const sampleMeadowMacro = (x: number, z: number): MeadowMacro => {
  const region = sampleNoise4(x * 0.021, z * 0.021);
  const patches = sampleNoise4(x * 0.085 + 11.3, z * 0.085 + 11.3);
  return {
    brightness: mix(0.9, 1.08, clamp01(region[3])),
    tint: meadowMacroTint(region, patches)
  };
};
