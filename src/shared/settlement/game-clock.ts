import {
  secondsToTicks, TICK_MS, ticksToSeconds
} from "../../../../island-of-settlers-shared/src/time/constants";

/** Seconds of game time at a whole tick count: exact for every path that reaches the same tick. */
export const tickSeconds = ticksToSeconds;

/**
 * The island's game clock (owner 2026-10-22): `gameNow = anchor + tick × 50 ms`, a UTC epoch in ms. The tick is
 * saved with the island; the anchor is the session's start time (server UTC for accounts, device time for guests),
 * so a restored island continues at the session's current time.
 */
export interface GameClock {
  /** Advances the saved tick counter by whole ticks (one per simulation step; offline jumps add many). */
  advance(ticks: number): void;
  /** Game time now (UTC epoch ms). */
  now(): number;
  /**
   * Restores the saved tick and keeps the reading continuous: a session's first load still reads its start time,
   * and a later (in-place upload) reload never moves game time back.
   */
  restore(tick: number): void;
  /**
   * Moves the reading to `time` without running ticks (offline catch-up skip, plan §10): the saved tick stays, as
   * when a skipped save is reloaded at `time`. Never moves game time back.
   */
  rebase(time: number): void;
  /** Ticks this island has run in total (saved). */
  tick(): number;
}

/**
 * `startTime`: what the clock reads at the loaded (or new) state. `override` replaces the reading (tests and
 * scene replays recorded before the game clock); the tick counter still runs.
 */
export const createGameClock = (startTime: number, override?: () => number): GameClock => {
  let anchor = startTime, ticks = 0;
  return {
    advance: count => { ticks += count; },
    now: override ?? (() => anchor + ticks * TICK_MS),
    rebase: time => { anchor = Math.max(anchor, time - ticks * TICK_MS); },
    restore: tick => {
      const reading = anchor + ticks * TICK_MS;
      ticks = tick;
      anchor = reading - tick * TICK_MS;
    },
    tick: () => ticks
  };
};

/** Game time through the settlement's options: the simulation always sets `now`; bare fixtures read 0. */
export const optionsNow = (options: { now?: () => number }) => options.now?.() ?? 0;

/** Whole ticks in a span of game seconds (offline jumps cover measured seconds). */
export const ticksForSeconds = secondsToTicks;

/** A saved tick counter: a whole, non-negative number. */
export const isGameTick = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
