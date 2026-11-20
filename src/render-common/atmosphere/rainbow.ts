import { smoothstep } from "../../shared/world/noise";
import { WORLD_TIME_SCALE } from "../environment-clock";
import { sunPresence } from "./sun-radiance";

/**
 * Rainbow after rain (presentation only, possessed view on Medium/High). The CPU side decides one
 * strength per frame from the weather; the shared atmosphere GLSL (rainbow-glsl.ts) draws the bows
 * around the antisolar point, so a sun higher than the bow radius hides it by geometry alone.
 */

/**
 * Remaining drops after a shower: follows the rain up at once and drains linearly over this many
 * real seconds (80 game seconds) once the rain fades, so a bow holds for about a minute after the
 * shower and then fades out over about two minutes (WEATHER_FADE in environment-controller.ts
 * takes about 43 s from heavy rain to dry).
 */
const MOISTURE_DRAIN_SECONDS = 80 * WORLD_TIME_SCALE;
/** Rain amount where the bow starts to show (light rain clearing) and where it is complete. */
const CLEARING_RAIN_START = 0.4;
const CLEARING_RAIN_END = 0.05;
/** Moisture range of the fade-out: full above the upper value, gone below the lower one. */
const MOISTURE_FADE_LOW = 0.1;
const MOISTURE_FADE_HIGH = 0.55;

/** Development review override (window.__rainbow in DEV): a fixed weather strength, or null. */
export const rainbowReview: { force: number | null } = { force: null };

const unit = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);

/** One step of the post-rain moisture: never below the current rain, drains when it eases. */
export const advanceRainbowMoisture = (moisture: number, rain: number, deltaSeconds: number) => {
  const drained = unit(moisture) - Math.max(0, deltaSeconds) / MOISTURE_DRAIN_SECONDS;
  return Math.max(unit(rain), unit(drained));
};

/**
 * Weather share of the bow (0..1): fades in while the rain eases from light to dry, holds while the
 * air is still moist and fades out as the moisture drains. Deterministic in its two inputs.
 */
export const rainbowWeatherStrength = (moisture: number, rain: number) => {
  const clearing = 1 - smoothstep(CLEARING_RAIN_END, CLEARING_RAIN_START, unit(rain));
  return clearing * smoothstep(MOISTURE_FADE_LOW, MOISTURE_FADE_HIGH, unit(moisture));
};

export interface RainbowInputs {
  /** Post-rain moisture (EnvironmentState.afterRain). */
  afterRain?: number;
  daylight: number;
  rain: number;
  snow: number;
}

/**
 * The frame's bow strength: the weather share times the sun's presence (daylight; the antisolar
 * geometry hides a high sun's bow by itself). Snowfall scatters no bow. `enabled` is the quality
 * flag and the possessed view (its blend while the camera moves in or out).
 */
export const rainbowStrength = (inputs: RainbowInputs, enabled: number) => {
  const gate = unit(enabled);
  if (gate <= 0) return 0;
  const weather = rainbowReview.force ?? rainbowWeatherStrength(inputs.afterRain ?? 0, inputs.rain);
  const dry = 1 - smoothstep(0, 0.3, unit(inputs.snow));
  return gate * unit(weather) * dry * sunPresence(unit(inputs.daylight));
};
