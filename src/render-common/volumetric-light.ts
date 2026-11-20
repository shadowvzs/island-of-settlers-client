/**
 * R06c volumetric sun shafts ("god rays") of the possessed view: the CPU side of the pass in
 * renderers/three/frame-god-rays.ts. Pure values and helpers (no GPU objects), so the fades are
 * testable and shared by the pass and its review tool.
 */

/** The live values of the pass; a development override (`__godRaysTuning`) edits a copy. */
export interface VolumetricLightTuning {
  /** Extinction per world unit along the view ray: far shafts fade into the analytic fog. */
  extinction: number;
  /** Brightness of the shafts relative to the R06a sun lobe colour of the airlight. */
  intensity: number;
  /**
   * Share of the Henyey-Greenstein forward lobe (its g is the R06a airlight's); the rest scatters
   * evenly, so shafts beside the sun stay visible while those toward it glow strongest.
   */
  lobeShare: number;
  /** World units the view ray is marched (the High near and middle cascades and some of the far one). */
  maxDistance: number;
  /**
   * Share of the fully lit in-scattering subtracted again (0..1): the analytic fog already holds
   * the sun lobe of lit air (R06a), so open sunny air gains only a little haze while the shadowed
   * air behind trees and buildings darkens: the shafts read as lit and shadowed volumes. The
   * darkening is bounded by the R06a sun lobe in that direction (weak with the sun behind the eye).
   */
  pivot: number;
  /** Share of the dawn strength left with the sun high (noon shafts are subtle). */
  noonShare: number;
  /** Depth tolerance of the blur and upsample: absolute view units plus a share of the view depth. */
  tolerance: { absolute: number; relative: number };
}

export const VOLUMETRIC_LIGHT_TUNING: Readonly<VolumetricLightTuning> = {
  extinction: 0.05,
  intensity: 0.05,
  lobeShare: 0.35,
  maxDistance: 64,
  noonShare: 0.3,
  pivot: 0.85,
  tolerance: { absolute: 0.3, relative: 0.03 }
};

/** Strongest Sun rays slider setting: twice the R06c intensity. */
export const VOLUMETRIC_LIGHT_MAX_STRENGTH = 2;

/**
 * The live tuning for a Sun rays slider strength (1 = the R06c look). Only the intensity scales:
 * the march and its pivot are unchanged, so lit and shadowed air keep their balance and every
 * strength is the same signed shaft buffer times a factor (linear, 100 % stays bit-identical).
 */
export const createVolumetricLightTuning = (strength = 1): VolumetricLightTuning => ({
  ...VOLUMETRIC_LIGHT_TUNING,
  intensity: VOLUMETRIC_LIGHT_TUNING.intensity *
    Math.min(VOLUMETRIC_LIGHT_MAX_STRENGTH, Math.max(0, strength)),
  tolerance: { ...VOLUMETRIC_LIGHT_TUNING.tolerance }
});

/** Ray-march steps per half-resolution texel; a 4 × 4 Bayer offset spreads them over 16 phases. */
export const VOLUMETRIC_LIGHT_STEPS = 16;

/** Below this strength the pass is skipped (no draw, the output adds nothing). */
const MIN_STRENGTH = 0.002;

/** The scene light and weather the shafts fade with (shared uniform values of the frame). */
export interface VolumetricLightScene {
  /** 0.45 clear .. 0.95 full overcast (rain, snow and authored weather). */
  cloudCover: number;
  /** 0 night .. 1 day. */
  daylight: number;
  /** Possessed-view weight: 0 in the strategic view and under cinematic shots. */
  possession: number;
  /** 0 dry .. 1 heavy rain. */
  rain: number;
  /** Strength of the sun shadow map (overcast and low-sun fade of the shadows themselves). */
  shadowWeight: number;
  /** Sine of the light's elevation (the light vector's y). */
  sunHeight: number;
}

const clampUnit = (value: number) => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clampUnit((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/**
 * 0..1 strength of the shafts: possessed only, none at night (the light vector is the moon then),
 * strongest with a low sun (dawn and dusk) and `noonShare` of it at noon, fading out with overcast,
 * rain and snow (their cloud cover) and with the shadow map's own strength. 0 skips the pass.
 */
export const volumetricLightStrength = (
  { cloudCover, daylight, possession, rain, shadowWeight, sunHeight }: VolumetricLightScene,
  noonShare: number = VOLUMETRIC_LIGHT_TUNING.noonShare
) => {
  const day = smoothstep(0.25, 0.75, daylight);
  const lowSun = 1 - smoothstep(0.3, 0.8, sunHeight);
  const elevation = noonShare + (1 - noonShare) * lowSun;
  const weather = (1 - smoothstep(0.5, 0.85, cloudCover)) * (1 - clampUnit(rain));
  const strength = clampUnit(possession) * day * elevation * weather * clampUnit(shadowWeight);
  return strength < MIN_STRENGTH ? 0 : strength;
};
