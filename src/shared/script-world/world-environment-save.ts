import { isPlainObject } from "../../../../island-of-settlers-shared/src/validation/index";
import type { WeatherState } from "../environment/weather-states";
import { WORLD_WEATHER_STATES } from "./constants";

/** The saved form of an island's world environment (ENV0) and its save check. */

/** A forward `timeOfDay` change in progress (eased like the presentation transition, in script ticks). */
export interface WorldHourTransition {
  day: number;
  from: number;
  hours: number;
  startTick: number;
  ticks: number;
}

/**
 * The last authored weather change (presentation reads it; null after a natural chain step): its fade in seconds,
 * or null for the natural slow fade.
 */
export interface WorldWeatherFade {
  seconds: number | null;
  tick: number;
}

export interface SavedWorldEnvironment {
  /** Clock seconds (`world-clock.ts`) at `anchorTick`. */
  anchorClock: number;
  anchorTick: number;
  cycling: boolean;
  /** Absolute whole hour (`day × 24 + hour`) the `clockHour` emission last reported. */
  hourSeen: number;
  random: number;
  transition: WorldHourTransition | null;
  weather: WeatherState;
  /** Script tick of the natural chain's next step. */
  weatherChangeTick: number;
  weatherFade: WorldWeatherFade | null;
}


const isTick = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const isFiniteNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value);

const validTransition = (value: unknown) => value === null || (isPlainObject(value) &&
  isTick(value.day) && isFiniteNumber(value.from) && isFiniteNumber(value.hours) && isTick(value.startTick) &&
  isTick(value.ticks));

const validFade = (value: unknown) => value === null || (isPlainObject(value) && isTick(value.tick) &&
  (value.seconds === null || (isFiniteNumber(value.seconds) && (value.seconds as number) >= 0)));

export const validSavedWorldEnvironment = (value: unknown): value is SavedWorldEnvironment =>
  isPlainObject(value) && isFiniteNumber(value.anchorClock) && (value.anchorClock as number) >= 0 &&
  isTick(value.anchorTick) && typeof value.cycling === "boolean" && Number.isSafeInteger(value.hourSeen) &&
  isTick(value.random) && validTransition(value.transition) && WORLD_WEATHER_STATES.includes(value.weather) &&
  isTick(value.weatherChangeTick) && validFade(value.weatherFade);
