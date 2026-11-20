import { WORLD_TIME_SCALE } from "../../render-common/environment-clock";
import { DMath } from "../math/deterministic-math";
import type { Random } from "../world/rng";

export type WeatherClimate = "temperate" | "winter";
/**
 * The presentation weather chain's climate: the world climates plus the cosmetic monsoon season (seasons plan 12,
 * two-season mode). The simulation's world environment never uses "monsoon".
 */
export type WeatherChainClimate = WeatherClimate | "monsoon";
export type WeatherState = "clear" | "cloudy" | "rain" | "snow" | "storm";

type Transitions = ReadonlyArray<readonly [WeatherState, number]>;

const TEMPERATE: Record<WeatherState, Transitions> = {
  clear: [["clear", .35], ["cloudy", .4], ["rain", .25]],
  cloudy: [["clear", .35], ["cloudy", .2], ["rain", .35], ["storm", .1]],
  rain: [["cloudy", .6], ["clear", .3], ["storm", .1]],
  snow: [["clear", .5], ["cloudy", .5]],
  storm: [["rain", .7], ["cloudy", .3]]
};
const WINTER: Record<WeatherState, Transitions> = {
  clear: [["clear", .4], ["cloudy", .4], ["snow", .2]],
  cloudy: [["clear", .3], ["cloudy", .2], ["snow", .5]],
  rain: [["clear", .4], ["cloudy", .6]],
  snow: [["cloudy", .6], ["clear", .4]],
  storm: [["clear", .4], ["cloudy", .6]]
};
/** Monsoon (cosmetic wet season): rain and storms most of the time, short dry spells. */
const MONSOON: Record<WeatherState, Transitions> = {
  clear: [["clear", .12], ["cloudy", .43], ["rain", .45]],
  cloudy: [["clear", .08], ["cloudy", .12], ["rain", .52], ["storm", .28]],
  rain: [["cloudy", .35], ["clear", .05], ["storm", .6]],
  snow: [["cloudy", .6], ["rain", .4]],
  storm: [["rain", .75], ["cloudy", .25]]
};
const CHAINS: Record<WeatherChainClimate, Record<WeatherState, Transitions>> = {
  monsoon: MONSOON, temperate: TEMPERATE, winter: WINTER
};
/** Monsoon dwell multipliers: long downpours and storms, brief clear spells. */
const MONSOON_DWELL: Record<WeatherState, number> = {
  clear: .5, cloudy: .8, rain: 1.8, snow: 1, storm: 2
};
/** Mean dwell in game seconds before the world-time multiplier. */
const MEAN_DWELL: Record<WeatherState, number> = {
  clear: 90, cloudy: 60, rain: 25, snow: 40, storm: 12
};

/** Weighted next state; one random draw. */
export const nextWeather = (
  state: WeatherState,
  climate: WeatherChainClimate,
  random: Random
): WeatherState => {
  const choices = CHAINS[climate][state];
  let roll = random();
  for (const [next, weight] of choices) {
    roll -= weight;
    if (roll <= 0) return next;
  }
  return choices[choices.length - 1]![0];
};

/**
 * Exponential dwell, clamped to 0.3–3 × mean, in real seconds (game time × WORLD_TIME_SCALE). `monsoon` (0..1, the
 * cosmetic season weight) stretches the wet states and shortens the dry ones; it never draws a random value.
 */
export const weatherDwellSeconds = (state: WeatherState, random: Random, monsoon = 0) => {
  const monsoonScale = 1 + (MONSOON_DWELL[state] - 1) * Math.min(1, Math.max(0, monsoon));
  const mean = MEAN_DWELL[state] * WORLD_TIME_SCALE * monsoonScale;
  return Math.min(mean * 3, Math.max(mean * .3, -mean * DMath.log(1 - random())));
};

/**
 * The season rule at runtime: the winter climate has no rain states, so an authored rain or storm becomes cloudy
 * there (the same rule `setSnowy` applies to the natural chain). Snow stays allowed on a temperate island: the
 * editor only warns about it (`weatherSeasonMismatch`).
 */
export const weatherForClimate = (state: WeatherState, climate: WeatherChainClimate): WeatherState => {
  if (climate === "winter" && (state === "rain" || state === "storm")) return "cloudy";
  return state;
};
