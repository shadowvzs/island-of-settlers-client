import type { SeasonWeights } from "./season-weights";

/** Snowfall of a change into winter while its cover builds (the snowfall starts first; T1). */
export const SEASON_SNOWFALL = 0.75;

export interface ShownPrecipitation {
  rain: number;
  snow: number;
}

/**
 * The presentation weather under the global season (render only, never the world environment): the transition
 * snowfall, and rain falling as snow where the season's snow cover lies.
 */
export const applySeasonPrecipitation = (
  rain: number, snow: number, season: SeasonWeights | undefined, target: ShownPrecipitation
) => {
  const cover = season?.snowCover ?? 0;
  const fall = (season?.snowfall ?? 0) * SEASON_SNOWFALL;
  target.rain = rain * (1 - cover);
  target.snow = Math.max(snow, rain * cover, fall);
  return target;
};

/** The nature chain uses the winter table (snow, no rain) once the season's snow cover is mostly built. */
export const isSeasonSnowClimate = (season: SeasonWeights | undefined) => (season?.snowCover ?? 0) >= 0.5;
