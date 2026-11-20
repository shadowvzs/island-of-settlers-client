import type { Color3, EnvironmentState } from "../environment";

/**
 * M1 monsoon look (seasons plan 12, cosmetic only): the wet season's sky and wind on top of the frame's
 * weather. The weather chain itself (more rain and storms) lives in `weather-states.ts`.
 */
export const MONSOON_WEATHER = Object.freeze({
  /** Extra cloud cover at full monsoon (the sky's settled cover tops out a little above 1 in storms). */
  cloudExtra: 0.18,
  /** Light lost under the heavy monsoon overcast: part always, the rest with the rain. */
  darkenBase: 0.06,
  darkenRain: 0.16,
  /** Gust envelope: the steady extra wind and the gust share on top (both times the monsoon weight). */
  gustWind: 0.75,
  steadyWind: 0.45,
  /** Rain screen pass: heavier sheets at full monsoon (times the rain amount). */
  rainBoost: 0.45
});

const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
const scaleColor = (color: Color3, factor: number): Color3 => [color[0] * factor, color[1] * factor, color[2] * factor];

/**
 * 0..1 gusts: three slow incommensurate waves, squared so calm spells are longer than the bursts (about a
 * 6-12 s rhythm). Continuous, so the cloud drift and the wind phase never jump.
 */
export const getMonsoonGust = (time: number) => {
  const wave = 0.5 + 0.3 * Math.sin(time * 0.71) + 0.22 * Math.sin(time * 1.93 + 1.3) +
    0.12 * Math.sin(time * 0.29 + 4);
  const gust = Math.min(1, Math.max(0, wave));
  return gust * gust;
};

/** Wind multiplier of the monsoon at a time: stronger and gusty. 1 outside the monsoon. */
export const getMonsoonWindScale = (monsoon: number, time: number) =>
  1 + monsoon * (MONSOON_WEATHER.steadyWind + MONSOON_WEATHER.gustWind * getMonsoonGust(time));

/**
 * Applies the monsoon weight (0..1) to a frame's environment in place: stronger, gustier wind (vegetation
 * sway, sails, pennants, cloud speed), heavier and darker cloud cover. Summer (0) leaves it untouched.
 */
export const applyMonsoonWeather = (environment: EnvironmentState, monsoon: number, time: number) => {
  if (!(monsoon > 0)) return environment;
  const weight = Math.min(1, monsoon);
  const wind = getMonsoonWindScale(weight, time);
  environment.windX *= wind;
  environment.windZ *= wind;
  environment.cloudCover += weight * MONSOON_WEATHER.cloudExtra;
  const darken = weight * (MONSOON_WEATHER.darkenBase + MONSOON_WEATHER.darkenRain * environment.rain);
  environment.sunColor = scaleColor(environment.sunColor, 1 - darken);
  environment.ambientSky = scaleColor(environment.ambientSky, 1 - darken * 0.6);
  environment.shadowStrength = mix(environment.shadowStrength, environment.shadowStrength * 0.7, darken * 3);
  return environment;
};

/** The rain screen pass amount: the monsoon's downpours fall heavier than ordinary rain. */
export const getMonsoonRainScale = (monsoon: number) =>
  1 + Math.min(1, Math.max(0, monsoon)) * MONSOON_WEATHER.rainBoost;
