import { scaleBloomByHighlights } from "./highlights";
import type { BloomQuality } from "./quality";
import {
  BLOOM_TUNING,
  type BloomPhase,
  type BloomPhaseRamp,
  type BloomTuning
} from "./shaders/frame-bloom-glsl";

/**
 * BLOOM-REFINEMENT (owner 2026-11-09): the bloom follows the time of day. Three phases carry their
 * own threshold, intensity, clipped-sun boost, halo radius and tint (BLOOM_TUNING.phases): night
 * (lit windows, lanterns, stars), golden (a low sun at dawn and dusk: a strong warm halo) and day
 * (a high sun: tasteful glints, no hazy sky). Every frame blends them by continuous weights of the
 * scene's daylight and sun height, so no value jumps across a phase change. Pure CPU, run once per
 * frame by the compositor; no per-frame allocation.
 */

/** One phase as the compositor reads it: the intensity already resolved for the preset's choice. */
export interface BloomRuntimePhase {
  clipWhiteOnly: number;
  clippedBoost: number;
  intensity: number;
  radiusScale: number;
  threshold: number;
  tint: readonly [number, number, number];
}

/** The bloom values the compositor reads every frame; `__bloomTuning` edits this copy (dev). */
export interface BloomRuntimeTuning {
  karisLuma: number;
  knee: number;
  phaseRamp: BloomPhaseRamp;
  phases: Record<BloomPhase, BloomRuntimePhase>;
  upsampleRadii: readonly number[];
  upsampleWeights: readonly number[];
}

/** This frame's blended values (written in place by resolveBloomFrame). */
export interface BloomFrameValues {
  clipWhiteOnly: number;
  /** Clipped-texel boost, already scaled by Highlights / glare. */
  clippedBoost: number;
  /** Share the linear output adds back, already scaled by Highlights / glare. */
  intensity: number;
  knee: number;
  radiusScale: number;
  threshold: number;
  tint: [number, number, number];
}

/** The scene light the phase weights read: shared `uDaylight` and the sun vector's height. */
export interface BloomLight {
  daylight: number;
  sunHeight: number;
}

export type BloomPhaseWeights = Record<BloomPhase, number>;

const BLOOM_PHASES: readonly BloomPhase[] = ["day", "golden", "night"];

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * Continuous phase weights (sum 1). `lit` eases from night to sunlit over the first part of the
 * daylight ramp (dusk keeps the sunlit values, as R11b); among sunlit frames a low sun is golden.
 * At daylight 0 the night weight is exactly 1, so the night look is the R11b one bit for bit.
 */
export const bloomPhaseWeights = (
  { daylight, sunHeight }: BloomLight,
  { daylightFull, goldenSunHeight }: BloomPhaseRamp,
  out: BloomPhaseWeights = { day: 0, golden: 0, night: 0 }
): BloomPhaseWeights => {
  const lit = smoothstep(0, daylightFull, daylight);
  const low = 1 - smoothstep(goldenSunHeight.full, goldenSunHeight.none, sunHeight);
  out.day = lit * (1 - low);
  out.golden = lit * low;
  out.night = 1 - lit;
  return out;
};

const weights: BloomPhaseWeights = { day: 0, golden: 0, night: 0 };

/** Blends the phases for this frame's light into `out` and applies the glare setting. */
export const resolveBloomFrame = (
  tuning: BloomRuntimeTuning,
  light: BloomLight,
  highlights: number,
  out: BloomFrameValues
): BloomFrameValues => {
  bloomPhaseWeights(light, tuning.phaseRamp, weights);
  let clipWhiteOnly = 0, clippedBoost = 0, intensity = 0, radiusScale = 0, threshold = 0;
  let red = 0, green = 0, blue = 0;
  for (const phase of BLOOM_PHASES) {
    const weight = weights[phase];
    const values = tuning.phases[phase];
    clipWhiteOnly += values.clipWhiteOnly * weight;
    clippedBoost += values.clippedBoost * weight;
    intensity += values.intensity * weight;
    radiusScale += values.radiusScale * weight;
    threshold += values.threshold * weight;
    red += values.tint[0] * weight;
    green += values.tint[1] * weight;
    blue += values.tint[2] * weight;
  }
  out.clipWhiteOnly = clipWhiteOnly;
  out.clippedBoost = scaleBloomByHighlights(clippedBoost, highlights);
  out.intensity = scaleBloomByHighlights(intensity, highlights);
  out.knee = tuning.knee;
  out.radiusScale = radiusScale;
  out.threshold = threshold;
  out.tint[0] = red;
  out.tint[1] = green;
  out.tint[2] = blue;
  return out;
};

export const createBloomFrameValues = (): BloomFrameValues => ({
  clipWhiteOnly: 0, clippedBoost: 0, intensity: 0, knee: 0, radiusScale: 1, threshold: 1, tint: [1, 1, 1]
});

/** The preset's copy of BLOOM_TUNING with each phase's intensity resolved for `quality`. */
export const createBloomRuntimeTuning = (
  quality: BloomQuality, source: BloomTuning = BLOOM_TUNING
): BloomRuntimeTuning => {
  const phase = (name: BloomPhase): BloomRuntimePhase => {
    const { clipWhiteOnly, clippedBoost, intensity, radiusScale, threshold, tint } = source.phases[name];
    return { clipWhiteOnly, clippedBoost, intensity: intensity[quality], radiusScale, threshold, tint: [...tint] };
  };
  return {
    karisLuma: source.karisLuma,
    knee: source.knee,
    phaseRamp: {
      daylightFull: source.phaseRamp.daylightFull,
      goldenSunHeight: { ...source.phaseRamp.goldenSunHeight }
    },
    phases: { day: phase("day"), golden: phase("golden"), night: phase("night") },
    upsampleRadii: [...source.upsampleRadii],
    upsampleWeights: [...source.upsampleWeights]
  };
};
