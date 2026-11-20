import {
  CYCLE_SECONDS, DAWN_SECONDS, DAY_HOURS_PER_SECOND, DUSK_SECONDS, HOURS_PER_DAY, NIGHT_END_HOUR,
  NIGHT_HOURS_PER_SECOND, NIGHT_START_HOUR
} from "./constants";

/**
 * The day/night clock (real seconds, rates in `constants.ts`): three seconds is one game minute, so a full day
 * takes 72 minutes, and the night (19:30 to 06:30) is compressed to half of its dark span (16.5 min instead of
 * 33 min), the saved time added to daylight. The presentation controller advances its clock with these rates; the
 * world environment (ENV0) reads the same clock in closed form from ticks: the "clock seconds" of a reading are
 * `day × CYCLE_SECONDS + seconds since that day's midnight`. Only +, −, ×, / and floor: replay-safe.
 */

export const isNightHour = (hour: number) => hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;

export interface ClockHour {
  day: number;
  hour: number;
}

/** Seconds since midnight at `hour` (0 ≤ hour < 24) on the compressed-night clock. */
const secondsOfHour = (hour: number) => {
  if (hour < NIGHT_END_HOUR) return hour / NIGHT_HOURS_PER_SECOND;
  if (hour < NIGHT_START_HOUR) return DAWN_SECONDS + (hour - NIGHT_END_HOUR) / DAY_HOURS_PER_SECOND;
  return DUSK_SECONDS + (hour - NIGHT_START_HOUR) / NIGHT_HOURS_PER_SECOND;
};

/** The hour `seconds` (0 ≤ seconds < CYCLE_SECONDS) after midnight. */
const hourOfSeconds = (seconds: number) => {
  if (seconds < DAWN_SECONDS) return seconds * NIGHT_HOURS_PER_SECOND;
  if (seconds < DUSK_SECONDS) return NIGHT_END_HOUR + (seconds - DAWN_SECONDS) * DAY_HOURS_PER_SECOND;
  return Math.min(HOURS_PER_DAY, NIGHT_START_HOUR + (seconds - DUSK_SECONDS) * NIGHT_HOURS_PER_SECOND) %
    HOURS_PER_DAY;
};

/** The clock seconds of a day and hour. */
export const clockSecondsOf = ({ day, hour }: ClockHour) => day * CYCLE_SECONDS + secondsOfHour(hour);

/** The day and hour of clock seconds (never negative). */
export const clockHourOf = (clockSeconds: number): ClockHour => {
  const day = Math.floor(clockSeconds / CYCLE_SECONDS);
  return { day, hour: hourOfSeconds(clockSeconds - day * CYCLE_SECONDS) };
};
