import type { EventBand } from "./event-queue.ts";

/** Where the exact-core runner is in the tick schedule. */
export interface BandCursor {
  band: EventBand;
  tick: number;
}

export const createBandCursor = (tick = 0, band: EventBand = 0): BandCursor => ({ band, tick });

export const beginTick = (cursor: BandCursor, tick: number): BandCursor => ({ band: 0, tick });

export const enterBand = (cursor: BandCursor, band: EventBand): BandCursor => ({ ...cursor, band });

/**
 * An event created by a handler uses the tick and band of the handler. A same-tick event for an
 * earlier band cannot run in this tick (the runner never goes back), so it moves to the next tick.
 * Past events are stale and dropped; future events keep their tick.
 */
export const normalizeBandEvent = <T extends { band: EventBand; tick: number }>(
  event: T, cursor: BandCursor
): T | null => {
  if (event.tick < cursor.tick) return null;
  if (event.tick > cursor.tick || event.band >= cursor.band) return event;
  return { ...event, tick: cursor.tick + 1 };
};
