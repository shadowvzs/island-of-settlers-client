/**
 * R11c possessed auto-exposure (eye adaptation). The strategic view keeps its fixed exposure; the
 * possessed eye measures the frame's mean log2 luminance on the GPU (frame-exposure-glsl.ts) and
 * eases an exposure offset towards a clamped target over one to two seconds. No readback: the GPU
 * passes mirror these pure functions, which the tests check (the TS twins of the shader).
 */

export interface EyeAdaptationTuning {
  /**
   * Share of a darker-than-key difference the exposure compensates (1 = all of it, up to the clamp).
   */
  brightenCompensation: number;
  /** Seconds of the exponential approach while the exposure rises (walking into shade). */
  brightenSeconds: number;
  /**
   * Share of a brighter-than-key difference the exposure compensates: lower than brightening,
   * because a darkened pastel sky turns grey long before a brightened shade looks wrong.
   */
  darkenCompensation: number;
  /** Seconds of the exponential approach while the exposure falls (stepping into the sun). */
  darkenSeconds: number;
  /** Daylight at and above which the full day brightening is allowed. */
  daylightFull: number;
  /**
   * Mean log2 linear luminance of the open coast at noon (daylight 1) that keeps 0 EV. The key follows
   * the daylight down to keyLog2Night, so the eye adapts to local light (shade, a lit sky) and keeps
   * the time-of-day mood: dusk and night stay dusk and night instead of being exposed like noon.
   */
  keyLog2Day: number;
  /** Mean log2 linear luminance of the open coast at night (daylight 0) that keeps 0 EV. */
  keyLog2Night: number;
  /** Most brightening by day (EV): a dark interior or deep forest shade. */
  maxEvDay: number;
  /** Most brightening at night (EV): the night keeps its mood, the eye only adapts a little. */
  maxEvNight: number;
  /** Most darkening (EV, negative): bright noon sand and sky. */
  minEv: number;
}

export const EYE_ADAPTATION_TUNING: EyeAdaptationTuning = {
  brightenCompensation: 0.75,
  brightenSeconds: 1.8,
  // 0.25 → 0.45 (owner 2026-11-17, TOOL-8 live-adaptation captures): noon beach views darken a little
  // more (−0.56 EV with the darker sand); views near the key (grass, buildings) barely move.
  darkenCompensation: 0.45,
  darkenSeconds: 1.2,
  daylightFull: 0.35,
  keyLog2Day: -2.8,
  keyLog2Night: -6.2,
  maxEvDay: 1.5,
  maxEvNight: 0.3,
  minEv: -1.5
};

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * The tuning for an Auto-exposure slider strength (0..1, 1 = the R11c tuning): both compensations
 * and the whole EV range scale together, so every adapted EV is exactly `strength` times the full
 * one (a linear slider in stops) while the key and the adaptation times stay as tuned.
 */
export const scaleEyeAdaptationTuning = (
  tuning: EyeAdaptationTuning,
  strength: number
): EyeAdaptationTuning => {
  const scale = clamp(strength, 0, 1);
  return {
    ...tuning,
    brightenCompensation: tuning.brightenCompensation * scale,
    darkenCompensation: tuning.darkenCompensation * scale,
    maxEvDay: tuning.maxEvDay * scale,
    maxEvNight: tuning.maxEvNight * scale,
    minEv: tuning.minEv * scale
  };
};

/** Longest frame step the adaptation takes at once (a stalled tab must not snap the exposure). */
export const EYE_ADAPTATION_MAX_STEP_SECONDS = 0.25;

/** This frame's key and EV clamp: night limits how far the eye brightens. */
export interface EyeAdaptationLimits {
  keyLog2: number;
  maxEv: number;
  minEv: number;
}

/** GLSL-style smoothstep. */
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Writes this frame's key and EV clamp into `out` from the scene daylight (0 night … 1 day). */
export const eyeAdaptationLimits = (
  daylight: number,
  tuning: EyeAdaptationTuning,
  out: EyeAdaptationLimits
): EyeAdaptationLimits => {
  const day = smoothstep(0, tuning.daylightFull, daylight);
  const light = clamp(daylight, 0, 1);
  out.keyLog2 = tuning.keyLog2Night + (tuning.keyLog2Day - tuning.keyLog2Night) * light;
  out.maxEv = tuning.maxEvNight + (tuning.maxEvDay - tuning.maxEvNight) * day;
  out.minEv = tuning.minEv;
  return out;
};

/** The EV the eye adapts towards for a frame whose mean log2 luminance is `meanLog2`. */
export const exposureTarget = (
  meanLog2: number,
  limits: EyeAdaptationLimits,
  tuning: Pick<EyeAdaptationTuning, "brightenCompensation" | "darkenCompensation">
): number => {
  const difference = limits.keyLog2 - meanLog2;
  const compensation = difference > 0 ? tuning.brightenCompensation : tuning.darkenCompensation;
  return clamp(difference * compensation, limits.minEv, limits.maxEv);
};

/** Share of the remaining distance one step of `dtSeconds` covers (dt clamped to the max step). */
export const adaptationRate = (dtSeconds: number, seconds: number): number =>
  1 - Math.exp(-clamp(dtSeconds, 0, EYE_ADAPTATION_MAX_STEP_SECONDS) / seconds);

/**
 * One adaptation step: an exponential approach of `previous` towards `target` over `dtSeconds`
 * (clamped to EYE_ADAPTATION_MAX_STEP_SECONDS); rising uses brightenSeconds, falling darkenSeconds.
 */
export const adaptExposure = (
  previous: number,
  target: number,
  dtSeconds: number,
  tuning: Pick<EyeAdaptationTuning, "brightenSeconds" | "darkenSeconds">
): number => {
  const seconds = target > previous ? tuning.brightenSeconds : tuning.darkenSeconds;
  return previous + (target - previous) * adaptationRate(dtSeconds, seconds);
};
