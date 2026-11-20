import type { MusicTrack } from "./music-catalog";

/**
 * Player status. Track titles stay as they are; the other states resolve through the active locale
 * when the view renders, so a language change never leaves a status line in the old language.
 */
export type MusicPlayerStatus =
  | { kind: "autoplayBlocked"; track: string }
  | { kind: "emptyPlaylist" }
  | { kind: "idle" }
  | { kind: "track"; track: string }
  | { kind: "unplayable" };

/** What the music player view reads; the native audio element stays the playback authority. */
export interface MusicPlayerState {
  collection: string;
  currentIndex: number;
  currentTime: number;
  duration: number;
  ended: boolean;
  loopCurrent: boolean;
  muted: boolean;
  paused: boolean;
  repeatPlaylist: boolean;
  status: MusicPlayerStatus;
  tracks: readonly MusicTrack[];
  volume: number;
}

/** Progress (`timeupdate`) reaches the view at most four times per second. */
export const MUSIC_PROGRESS_INTERVAL_MS = 250;

export interface PublishClock {
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
  now: () => number;
  setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
}

const systemClock: PublishClock = {
  clearTimeout: handle => clearTimeout(handle),
  now: () => Date.now(),
  setTimeout: (callback, delay) => setTimeout(callback, delay)
};

/**
 * Publishes immediately (`now`) or at most once per interval (`request`, leading and trailing), so
 * the latest value always arrives without one publication per audio event.
 */
export const createThrottledPublisher = (
  publish: () => void, intervalMs: number, clock: PublishClock = systemClock
) => {
  let lastPublished = -Infinity;
  let pending: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (pending === undefined) return;
    clock.clearTimeout(pending);
    pending = undefined;
  };
  const now = () => {
    cancel();
    lastPublished = clock.now();
    publish();
  };
  const request = () => {
    if (pending !== undefined) return;
    const wait = lastPublished + intervalMs - clock.now();
    if (wait <= 0) return now();
    pending = clock.setTimeout(now, wait);
  };
  return { cancel, now, request };
};

/** Seconds the playback reports; NaN/Infinity (no metadata, live streams) read as zero. */
export const finiteSeconds = (seconds: number) => Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
