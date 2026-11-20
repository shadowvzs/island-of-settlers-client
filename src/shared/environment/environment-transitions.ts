/**
 * Timed environment transitions (CIN6): an authored weather fade over a fixed time and the forward-only hour
 * transition shared by the cinematic `timeOfDay` step and the quest claim effect "time of day" (owner 2026-11-09:
 * a fast forward-only change over 3 to 6 seconds). Pure, so the controller and its tests share one definition.
 */
import { clamp01, lerp, smoothstep01 } from "../world/noise";
import { HOUR_TRANSITION_MAX_SECONDS, HOUR_TRANSITION_MIN_SECONDS, HOURS_PER_DAY } from "./constants";

/** Hours forward from `from` to `to` (0 up to, not including, 24): time never runs backwards. */
export const forwardHours = (from: number, to: number) =>
  (((to - from) % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;

/** The default length of a forward jump of `hours`: 3 s for a moment, up to 6 s for nearly a full day. */
export const hourTransitionSeconds = (hours: number) => HOUR_TRANSITION_MIN_SECONDS +
  (HOUR_TRANSITION_MAX_SECONDS - HOUR_TRANSITION_MIN_SECONDS) * clamp01(hours / HOURS_PER_DAY);

export interface HourTransition {
  day: number;
  elapsed: number;
  from: number;
  hours: number;
  seconds: number;
}

export interface ClockReading {
  day: number;
  done: boolean;
  hour: number;
}

/** The clock `elapsed` seconds into a transition: eased in and out, the day counted on every midnight passed. */
export const readHourTransition = (transition: HourTransition): ClockReading => {
  const progress = transition.seconds > 0 ? clamp01(transition.elapsed / transition.seconds) : 1;
  const unwrapped = transition.from + transition.hours * smoothstep01(progress);
  return {
    day: transition.day + Math.floor(unwrapped / HOURS_PER_DAY),
    done: progress >= 1,
    hour: unwrapped % HOURS_PER_DAY
  };
};

/** Rain, snow and cloud cover: the values a weather fade moves between. */
export interface WeatherAmounts {
  cloud: number;
  rain: number;
  snow: number;
}

export interface WeatherFade {
  elapsed: number;
  from: WeatherAmounts;
  seconds: number;
}

/** The amounts `elapsed` seconds into an authored fade from `fade.from` to `to` (linear, like the natural fade). */
export const readWeatherFade = (fade: WeatherFade, to: WeatherAmounts): WeatherAmounts & { done: boolean } => {
  const progress = fade.seconds > 0 ? clamp01(fade.elapsed / fade.seconds) : 1;
  return {
    cloud: lerp(fade.from.cloud, to.cloud, progress),
    done: progress >= 1,
    rain: lerp(fade.from.rain, to.rain, progress),
    snow: lerp(fade.from.snow, to.snow, progress)
  };
};
