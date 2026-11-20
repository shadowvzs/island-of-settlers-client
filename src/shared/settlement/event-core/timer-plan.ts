import type { EventBand, EventQueue } from "./event-queue";
import { tickOfTime } from "./time-base";

export interface BoundarySchedule {
  band: EventBand;
  entity: string;
  id: string;
  kind: string;
  order: number;
  version: number;
}

/**
 * Schedules the next absolute-time boundary (tree stage, field change, ship timer) into the queue.
 * The caller supplies the next game time; `null` means the timer is finished. The tick is the first
 * fixed tick at or after that time, so a boundary due exactly at 30 s lands on tick 600.
 */
export const scheduleBoundary = (
  queue: EventQueue, schedule: BoundarySchedule, currentTick: number, currentTime: number,
  nextTime: (time: number) => number | null
) => {
  const next = nextTime(currentTime);
  if (next === null || next <= currentTime) return null;
  const tick = tickOfTime(next);
  if (tick <= currentTick) return null;
  queue.push({ ...schedule, tick });
  return tick;
};
