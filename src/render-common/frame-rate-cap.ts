/**
 * C13 frame-rate limit: the display rate is measured from requestAnimationFrame itself, and a
 * limit draws every n-th display frame, so frames stay evenly paced (60 Hz: 60 or 30 fps;
 * 120 Hz: 60 or 40 fps). Presentation only; the simulation clock does not depend on it.
 */

/** Player choice: no limit, at most 60 fps, or the battery saver (30 fps, 40 fps at 100 Hz and above). */
export type FrameRateLimit = "display" | "limit60" | "saver";

export const FRAME_RATE_LIMITS: readonly FrameRateLimit[] = ["display", "limit60", "saver"];

const SAVER_FPS = 30;
const SAVER_FAST_DISPLAY_FPS = 40;
const LIMIT_FPS = 60;
/** Displays at or above this rate use the 40 fps saver (120 Hz / 3). */
const FAST_DISPLAY_HZ = 100;
/** Common display rates; the measurement snaps to the nearest one. */
const DISPLAY_RATES = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240] as const;
const DEFAULT_DISPLAY_HZ = 60;
const SAMPLE_FRAMES = 120;
/** The fastest tenth of the callbacks shows the display rate even when some frames run long. */
const FAST_SHARE = 0.1;
/** A display frame may arrive this share of its period early and still count as due. */
const EARLY_TOLERANCE = 0.5;

export const isFrameRateLimit = (value: unknown): value is FrameRateLimit =>
  (FRAME_RATE_LIMITS as readonly unknown[]).includes(value);

/** The nearest common display rate to a measured callback interval (ms). */
export const snapDisplayRate = (intervalMs: number) => {
  if (!(intervalMs > 0)) return DEFAULT_DISPLAY_HZ;
  const measured = 1000 / intervalMs;
  let best: number = DISPLAY_RATES[0];
  for (const rate of DISPLAY_RATES) if (Math.abs(rate - measured) < Math.abs(best - measured)) best = rate;
  return best;
};

/** The frame rate a limit aims at on a display of `displayHz`; null draws every display frame. */
export const limitFps = (limit: FrameRateLimit, displayHz: number) => {
  if (limit === "display") return null;
  if (limit === "limit60") return LIMIT_FPS;
  return displayHz >= FAST_DISPLAY_HZ ? SAVER_FAST_DISPLAY_FPS : SAVER_FPS;
};

/** Display frames per drawn frame: 1 draws every frame. */
export const frameDivisor = (limit: FrameRateLimit, displayHz: number) => {
  const fps = limitFps(limit, displayHz);
  if (fps === null) return 1;
  return Math.max(1, Math.floor(displayHz / fps + 1e-6));
};

export const createFrameRateCap = (initial: FrameRateLimit = "display") => {
  const callbacks = new Float32Array(SAMPLE_FRAMES);
  let cursor = 0;
  let count = 0;
  let displayHz = DEFAULT_DISPLAY_HZ;
  let limit = initial;
  let lastCallback: number | null = null;
  let lastDrawn = -Infinity;

  const measure = (now: number) => {
    if (lastCallback !== null) {
      callbacks[cursor] = now - lastCallback;
      cursor = (cursor + 1) % SAMPLE_FRAMES;
      count = Math.min(SAMPLE_FRAMES, count + 1);
      if (cursor === 0) {
        const sorted = Array.from(callbacks.subarray(0, count)).sort((left, right) => left - right);
        displayHz = snapDisplayRate(sorted[Math.floor(count * FAST_SHARE)] ?? 0);
      }
    }
    lastCallback = now;
  };

  /** Every animation-frame callback asks once; true when this one should draw. */
  const due = (now: number) => {
    measure(now);
    const divisor = frameDivisor(limit, displayHz);
    if (divisor === 1) {
      lastDrawn = now;
      return true;
    }
    const period = 1000 / displayHz;
    if (now - lastDrawn < (divisor - EARLY_TOLERANCE) * period) return false;
    lastDrawn = now;
    return true;
  };

  /** A hidden tab or a pause: the next callback starts a fresh interval. */
  const resume = () => { lastCallback = null; };

  return {
    displayHz: () => displayHz,
    due,
    resume,
    setLimit: (next: FrameRateLimit) => { limit = next; }
  };
};

export type FrameRateCap = ReturnType<typeof createFrameRateCap>;
