import { WORLD_TIME_SCALE } from "../../render-common/environment-clock";

/** Hours of one game day (the environment clock). */
export const HOURS_PER_DAY = 24;
/** The shortest and the longest forward hour transition (seconds, owner 2026-11-09); longer jumps take longer. */
export const HOUR_TRANSITION_MIN_SECONDS = 3;
export const HOUR_TRANSITION_MAX_SECONDS = 6;
const MINUTES_PER_HOUR = 60;

/** The day/night clock (`world-clock.ts`): real seconds of one day and the compressed-night rates. */
export const CYCLE_SECONDS = HOURS_PER_DAY * MINUTES_PER_HOUR * WORLD_TIME_SCALE;
export const NIGHT_START_HOUR = 19.5;
export const NIGHT_END_HOUR = 6.5;
export const NIGHT_HOURS = HOURS_PER_DAY - NIGHT_START_HOUR + NIGHT_END_HOUR;
export const BASE_HOURS_PER_SECOND = HOURS_PER_DAY / CYCLE_SECONDS;
export const NIGHT_DURATION_SECONDS = (NIGHT_HOURS / BASE_HOURS_PER_SECOND) / 2;
export const NIGHT_HOURS_PER_SECOND = NIGHT_HOURS / NIGHT_DURATION_SECONDS;
export const DAY_HOURS_PER_SECOND = (HOURS_PER_DAY - NIGHT_HOURS) / (CYCLE_SECONDS - NIGHT_DURATION_SECONDS);

/** Clock seconds from midnight to the end of the morning night and to the start of the evening night. */
export const DAWN_SECONDS = NIGHT_END_HOUR / NIGHT_HOURS_PER_SECOND;
export const DUSK_SECONDS = DAWN_SECONDS + (NIGHT_START_HOUR - NIGHT_END_HOUR) / DAY_HOURS_PER_SECOND;

