import { type BandCursor, beginTick, createBandCursor, enterBand, normalizeBandEvent } from "./band-cursor.ts";
import type { EventQueue, ScheduledEvent } from "./event-queue.ts";

export interface EventRunnerOptions {
  /** Last tick to process (the event at this tick still runs). */
  endTick: number;
  /** Receives each runnable event; it may push more events into the same queue. */
  handler: (event: ScheduledEvent, cursor: BandCursor) => void;
  /** Cursor from a previous partial run/checkpoint. Defaults to the start of time. */
  cursor?: BandCursor;
}

export interface EventRunnerResult {
  cursor: BandCursor;
  events: number;
}

/**
 * Drains the queue in tick/band order. A handler that creates an earlier-band event for the current
 * tick does not rewind the runner: the event is moved to the next tick. Events beyond `endTick`
 * stay queued for a later run.
 */
export const runEventQueue = (
  queue: EventQueue, { cursor: suppliedCursor, endTick, handler }: EventRunnerOptions
): EventRunnerResult => {
  let cursor = suppliedCursor ?? createBandCursor();
  let events = 0;
  while (queue.size) {
    const next = queue.peek()!;
    if (next.tick > endTick) break;
    if (next.tick < cursor.tick) { queue.pop(); continue; }
    if (next.tick !== cursor.tick) cursor = beginTick(cursor, next.tick);
    const normalized = normalizeBandEvent(next, cursor);
    if (!normalized) { queue.pop(); continue; }
    if (normalized !== next) { queue.pop(); queue.push(normalized); continue; }
    queue.pop();
    cursor = enterBand(cursor, next.band);
    handler(next, cursor);
    events++;
  }
  return { cursor, events };
};
