import { TICK_SECONDS } from "../../../../../island-of-settlers-shared/src/time/constants";
import { type EventBand, type EventQueue } from "./event-queue.ts";

/** Scheduler accumulation threshold in the fixed tick. */
const SCHEDULER_THRESHOLD = 0.5;

export interface AccumulatorAdvance {
  fireTicks: number[];
  residue: number;
}

/**
 * Reproduces `value += step; if (value >= threshold) { value -= threshold; fire }` for whole ticks.
 * The loop is intentional: float addition is order-sensitive (`0.05 * 10` is not the same as ten
 * additions), and the design's first scheduler fire must stay on tick 11, not tick 10. This is a
 * scalar parity kernel; the event core still has to decide which systems can use it.
 */
export const advanceAccumulator = (
  startValue: number, ticks: number, step = TICK_SECONDS, threshold = SCHEDULER_THRESHOLD
): AccumulatorAdvance => {
  let value = startValue;
  const fireTicks: number[] = [];
  for (let tick = 1; tick <= ticks; tick++) {
    value += step;
    if (value < threshold) continue;
    value -= threshold;
    fireTicks.push(tick);
  }
  return { fireTicks, residue: value };
};

export interface CountdownAdvance {
  /** The first tick the timer reached zero, or null when it is still running. */
  fireTick: number | null;
  residue: number;
}

/** Reproduces `timer -= dt; if (timer <= 0) fire` for a countdown without skipping the residue. */
export const advanceCountdown = (
  startValue: number, ticks: number, step = TICK_SECONDS
): CountdownAdvance => {
  let value = startValue;
  for (let tick = 1; tick <= ticks; tick++) {
    value -= step;
    if (value <= 0) return { fireTick: tick, residue: value };
  }
  return { fireTick: null, residue: value };
};

export interface TimerSchedule {
  band: EventBand;
  entity: string;
  id: string;
  kind: string;
  order: number;
  startTick: number;
  startValue: number;
  version: number;
}

/** Schedules every accumulator fire inside the next `ticks` as an event at `startTick + offset`. */
export const scheduleAccumulator = (
  queue: EventQueue, schedule: TimerSchedule, ticks: number, step = TICK_SECONDS,
  threshold = SCHEDULER_THRESHOLD
) => {
  const advance = advanceAccumulator(schedule.startValue, ticks, step, threshold);
  for (const offset of advance.fireTicks) {
    queue.push({
      band: schedule.band, entity: schedule.entity, id: schedule.id, kind: schedule.kind,
      order: schedule.order, tick: schedule.startTick + offset, version: schedule.version
    });
  }
  return advance;
};

/** Schedules the first countdown fire inside the next `ticks`, if it reaches zero. */
export const scheduleCountdown = (
  queue: EventQueue, schedule: TimerSchedule, ticks: number, step = TICK_SECONDS
) => {
  const advance = advanceCountdown(schedule.startValue, ticks, step);
  if (advance.fireTick !== null) {
    queue.push({
      band: schedule.band, entity: schedule.entity, id: schedule.id, kind: schedule.kind,
      order: schedule.order, tick: schedule.startTick + advance.fireTick, version: schedule.version
    });
  }
  return advance;
};
