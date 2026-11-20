/**
 * Presentation-time helpers for the exploration session (EXPLORE-01B). All timestamps are injected
 * elapsed milliseconds from `ExplorationHost.now`; nothing here reads animation frames, wall time,
 * `Date` or the settlement tick.
 */

export interface ExplorationClock {
  now: () => number;
  elapsedMs: (since: number) => number;
  progress: (startedAt: number, durationMs: number) => number;
  remainingMs: (deadline: number) => number;
  reached: (deadline: number) => boolean;
}

const finiteNow = (readNow: () => number) => {
  const value = readNow();
  return Number.isFinite(value) ? value : 0;
};

export const elapsedMilliseconds = (now: number, since: number) =>
  Number.isFinite(since) ? Math.max(0, now - since) : 0;

export const explorationProgress = (now: number, startedAt: number, durationMs: number) => {
  if (!(durationMs > 0)) return 1;
  return Math.min(1, Math.max(0, (now - startedAt) / durationMs));
};

/** Whole milliseconds for the HUD countdown; never negative. */
export const remainingMilliseconds = (now: number, deadline: number) =>
  Number.isFinite(deadline) ? Math.max(0, Math.ceil(deadline - now)) : 0;

export const deadlineReached = (now: number, deadline: number) =>
  Number.isFinite(deadline) && now >= deadline;

export const createExplorationClock = (readNow: () => number): ExplorationClock => ({
  elapsedMs: since => elapsedMilliseconds(finiteNow(readNow), since),
  now: () => finiteNow(readNow),
  progress: (startedAt, durationMs) =>
    explorationProgress(finiteNow(readNow), startedAt, durationMs),
  reached: deadline => deadlineReached(finiteNow(readNow), deadline),
  remainingMs: deadline => remainingMilliseconds(finiteNow(readNow), deadline)
});
