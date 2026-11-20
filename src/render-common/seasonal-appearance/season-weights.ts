import type {
  SeasonMode,
  SeasonPhase,
  VisualSeason
} from "../../../../island-of-settlers-shared/src/appearance/season-calendar";

/**
 * Per-island season look, 0..1 each (render only, never saved): what the GPU season uniforms blend.
 * Winter's snow cover ramps on the GPU too (T1); the ice (seasons-5), the winter water colour and the critter
 * hibernation (seasons-6) follow its ice ramp. The winter coats and the grass ring still switch with the prepared
 * rebuild at mid-transition.
 */
export interface SeasonWeights {
  autumn: number;
  /** Bare broadleaf trees (snow-free late autumn / early spring inside the four-season transitions). */
  dormant: number;
  /** The dry season of the two-season mode (summer opposite the monsoon): the meadow leans to straw. */
  drySeason: number;
  monsoon: number;
  /** Global snow cover ramp (snow builds after the first snowfall; sunny slopes melt first). */
  snowCover: number;
  /** Seasonal snowfall while the snow cover builds (the weather chain snows in full winter). */
  snowfall: number;
  spring: number;
  winter: number;
}

/** Island climate for the season rules (plan 12): tropical stays mild, polar keeps its theme snow. */
export type SeasonClimate = "polar" | "temperate" | "tropical";

export const SUMMER_WEIGHTS: Readonly<SeasonWeights> = Object.freeze({
  autumn: 0, dormant: 0, drySeason: 0, monsoon: 0, snowCover: 0, snowfall: 0, spring: 0, winter: 0
});

/** Tropical islands show autumn only as a light dry tint. */
const TROPICAL_AUTUMN = 0.35;

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const weightOf = (phase: SeasonPhase, season: VisualSeason) =>
  (phase.from === season ? 1 - phase.blend : 0) + (phase.to === season ? phase.blend : 0);

/**
 * Bare trees inside the snow transitions: leaves drop over the first half of a change into winter (the
 * snow follows) and stay off through winter (the GPU snow keeps the canonical crowns, T1); out of winter
 * they stay bare through the melt until they bud in the second half.
 */
const getDormant = (phase: SeasonPhase) => {
  const into = phase.to === "winter", out = phase.from === "winter";
  if (into && out) return 1;
  if (into) return smoothstep(0, 0.5, phase.blend);
  if (out) return 1 - smoothstep(0.5, 1, phase.blend);
  return 0;
};

/**
 * Blend ranges of the snow ramp (transition share 0..1). Into winter the leaves fall first (dormant, 0..0.5), the
 * snowfall starts once they are mostly down and the cover builds over the second half; out of winter the snow
 * melts over the first half and the trees bud over the second (a snow-free bare stretch on both sides).
 */
const SNOWFALL_START = [0.3, 0.4] as const;
const SNOWFALL_END = [0.85, 1] as const;
const SNOW_BUILD = [0.42, 0.95] as const;
const SNOW_MELT = [0, 0.4] as const;

/**
 * Snow cover and snowfall of a change into or out of winter (owner 2026-11-17): the snowfall starts first,
 * the cover builds over the rest of the transition; out of winter the snow melts over the first half (the
 * meadow flowers open after it, spring-bloom.ts).
 */
const getSnow = (phase: SeasonPhase) => {
  const into = phase.to === "winter", out = phase.from === "winter";
  if (into && out) return { snowCover: 1, snowfall: 0 };
  if (out) return { snowCover: 1 - smoothstep(SNOW_MELT[0], SNOW_MELT[1], phase.blend), snowfall: 0 };
  if (!into) return { snowCover: 0, snowfall: 0 };
  return {
    snowCover: smoothstep(SNOW_BUILD[0], SNOW_BUILD[1], phase.blend),
    snowfall: smoothstep(SNOWFALL_START[0], SNOWFALL_START[1], phase.blend)
      * (1 - smoothstep(SNOWFALL_END[0], SNOWFALL_END[1], phase.blend))
  };
};

/** Summer opposite the monsoon (two-season mode, or a monsoon change) is the dry season. */
const getDrySeason = (phase: SeasonPhase, mode: SeasonMode | undefined) => {
  const monsoonSide = phase.from === "monsoon" || phase.to === "monsoon";
  return mode === "two" || monsoonSide ? weightOf(phase, "summer") : 0;
};

/** The season look of one island from the global phase and the island's climate. */
export const resolveSeasonWeights = (
  phase: SeasonPhase, climate: SeasonClimate, mode?: SeasonMode
): SeasonWeights => {
  const weights: SeasonWeights = {
    autumn: weightOf(phase, "autumn"),
    dormant: getDormant(phase),
    drySeason: getDrySeason(phase, mode),
    monsoon: weightOf(phase, "monsoon"),
    ...getSnow(phase),
    spring: weightOf(phase, "spring"),
    winter: weightOf(phase, "winter")
  };
  if (climate !== "tropical") return weights;
  return {
    ...weights, autumn: weights.autumn * TROPICAL_AUTUMN, dormant: 0, snowCover: 0, snowfall: 0, winter: 0
  };
};

/** True while a phase can show global snow: the GPU snow path is armed by a rebuild before it ramps. */
export const isSeasonSnowPhase = (phase: SeasonPhase) => phase.from === "winter" || phase.to === "winter";

/** The island climate from its expedition theme and natural snow. */
export const getSeasonClimate = (expeditionTheme: string | undefined, snowy: boolean): SeasonClimate => {
  if (expeditionTheme === "tropical") return "tropical";
  return snowy || expeditionTheme === "winter" ? "polar" : "temperate";
};
