/**
 * The unified colour contract (R04, "A"): every world shader ends with
 * linear radiance -> exposure -> tonemapper -> sRGB -> shared art grade -> dither.
 * Pure data and parsing only; the GLSL lives in shaders/color-output-glsl.ts and the Three.js
 * binding in renderers/three/color/color-output-control.ts.
 */

import { clamp01, lerp, smoothstep } from "../shared/world/noise";

/** The two tonemapper curves; the development `?tonemap=` override names one of them. */
export type ColorToneMapper = "agx" | "neutral";

/**
 * Player setting Tone (decision D2, option C): Vivid is Neutral with the baseline daytime
 * saturation, Filmic is AgX, and Auto blends from Vivid by day to Filmic at night and in rain.
 * Presentation only: nothing in gameplay, saves or simulation reads it.
 */
export type ColorTone = "auto" | "filmic" | "vivid";

export const DEFAULT_COLOR_TONE: ColorTone = "auto";

/** Menu order of the Tone choices. */
export const COLOR_TONES: readonly ColorTone[] = ["auto", "vivid", "filmic"];

export const isColorTone = (value: unknown): value is ColorTone =>
  value === "auto" || value === "filmic" || value === "vivid";

const DEFAULT_COLOR_TONE_MAPPER: ColorToneMapper = "neutral";

/** `uColorToneMapper` values: 0 is the safe default an unbound uniform also reads as. */
export const COLOR_TONE_MAPPER_INDEX: Readonly<Record<ColorToneMapper, number>> = {
  agx: 1,
  neutral: 0
};

/**
 * Exposure per tonemapper, fitted so mid tones keep today's display values: Neutral below its
 * 0.76 shoulder is the identity, and AgX maps display 0.5 to about 0.53 at exposure 1.
 */
const COLOR_TONE_MAPPER_EXPOSURE: Readonly<Record<ColorToneMapper, number>> = {
  agx: 1,
  neutral: 1
};

/**
 * Sunlight the Auto tone follows: daylight gated by the sun's height, so the low sun of dawn and
 * dusk counts as dim even though `daylight` already reads about 0.95 at the Dawn preset. Full
 * day (high sun, daylight 1) stays 1 and the moon's elevation at night never counts (daylight 0).
 */
const sunLightFor = (daylight: number, sunElevation: number) =>
  daylight * smoothstep(0.15, 0.65, sunElevation);

/**
 * The tonemapper weight of a Tone choice (`uColorToneMapper`: 0 Vivid .. 1 Filmic). Auto turns
 * Filmic as sunlight fades (dawn, dusk, night) or as rain sets in; high sun stays Vivid. Pure and
 * worker-safe.
 */
export const toneWeightFor = (
  tone: ColorTone,
  daylight: number,
  rain: number,
  sunElevation: number
): number => {
  if (tone === "vivid") return 0;
  if (tone === "filmic") return 1;
  const dark = 1 - smoothstep(0.35, 0.85, sunLightFor(daylight, sunElevation));
  const wet = smoothstep(0.15, 0.6, rain);
  return clamp01(Math.max(dark, wet));
};

/** The fitted exposure of a blended tonemapper weight. */
export const exposureForWeight = (weight: number) =>
  lerp(COLOR_TONE_MAPPER_EXPOSURE.neutral, COLOR_TONE_MAPPER_EXPOSURE.agx, clamp01(weight));

/**
 * Khronos PBR Neutral's toe offset equals the dielectric F0 (0.04 in the reference). It removes
 * the white specular floor every PBR surface reflects. Since R05 only the built-in materials on
 * Medium+ reflect the sky environment; terrain, plants and the other raw shaders have no specular
 * floor, so the reference toe eats real colour (measured on the day matrix: −12 luma, +0.22 mean
 * saturation on High and Minimal). Zero disables only the toe; enabling it is an owner decision.
 */
export const COLOR_NEUTRAL_TOE_F0 = 0;

export const COLOR_NEUTRAL = {
  /** Shoulder start: the reference 0.8 minus the toe lift (0.04). */
  startBase: 0.8,
  startToe: 0.04,
  /** startBase - startToe; the TSL and GLSL use the same value. */
  startCompression: 0.76,
  desaturation: 0.15
} as const;

/** AgX log2 exposure range shared by the GLSL and TSL twins. */
export const COLOR_AGX_EV = { max: 4.026069, min: -12.47393 } as const;


/** Today's art grade, now applied once after tonemapping in display space. */
export const COLOR_GRADE = {
  contrast: 1.05,
  rainDesaturation: 0.3,
  saturation: 1.12
} as const;

/**
 * `uColorOutputMode`: what a world shader writes. `display` (0, the unbound default) is the
 * final pixel; `linearCapture` keeps linear radiance for the refraction target; `scene` (R10)
 * writes sRGB-encoded, untonemapped radiance into the HDR scene target, whose single output pass
 * applies exposure, tonemapper, grade and dither once.
 */
export const COLOR_OUTPUT_MODE = {
  display: 0,
  linearCapture: 1,
  scene: 2
} as const;

export type ColorOutputMode = (typeof COLOR_OUTPUT_MODE)[keyof typeof COLOR_OUTPUT_MODE];

export interface ColorOutputSettings {
  exposure: number;
  toneMapper: ColorToneMapper;
}

export const isColorToneMapper = (value: unknown): value is ColorToneMapper =>
  value === "agx" || value === "neutral";

/** `?tonemap=neutral|agx` (development only); anything else keeps the default. */
export const readColorToneMapper = (value: string | null): ColorToneMapper | null =>
  isColorToneMapper(value) ? value : null;

/** `?exposure=` (development only): a finite positive multiplier, otherwise none. */
export const readColorExposure = (value: string | null): number | null => {
  if (value === null || value.trim() === "") return null;
  const exposure = Number(value);
  return Number.isFinite(exposure) && exposure > 0 ? exposure : null;
};

/** The tonemapper's fitted exposure unless a development override names another one. */
export const resolveColorOutput = (
  toneMapper: ColorToneMapper | null | undefined,
  exposure?: number | null
): ColorOutputSettings => {
  const chosen = toneMapper ?? DEFAULT_COLOR_TONE_MAPPER;
  return { exposure: exposure ?? COLOR_TONE_MAPPER_EXPOSURE[chosen], toneMapper: chosen };
};
