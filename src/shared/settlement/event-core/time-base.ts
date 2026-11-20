import { TICK_SECONDS } from "../../../../../island-of-settlers-shared/src/time/constants";
import { tickSeconds } from "../game-clock";

/**
 * The first whole tick at or after `seconds` from the current time. It uses the same `tickSeconds`
 * arithmetic as the simulation: `tick * 0.05` differs from `tick * 50 / 1000` at large tick counts.
 */
export const tickOfTime = (seconds: number) => {
  let tick = Math.max(0, Math.ceil(seconds / TICK_SECONDS));
  while (tick > 0 && tickSeconds(tick - 1) >= seconds) tick--;
  while (tickSeconds(tick) < seconds) tick++;
  return tick;
};

/** Game time of a whole tick, exactly as the live clock computes it. */
export const timeOfTick = (tick: number) => tickSeconds(tick);
