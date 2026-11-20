import { clamp01, lerp } from "../../shared/world/noise";

/** The parts of the music player a cue fade drives. */
export interface MusicCueTarget {
  playing: () => boolean;
  setCueGain: (gain: number) => void;
  stop: () => void;
}

/** One music change: the current music fades out, then `start` begins the new one, which fades in to `gain`. */
export interface MusicCueChange {
  fadeInMs: number;
  fadeOutMs: number;
  /** Cue gain 0..1 the new music settles at (the script's `volume`). */
  gain: number;
  /** Starts the new music (false: nothing started, the gain returns to 1); null fades out and stops. */
  start: (() => boolean) | null;
}

export interface MusicCueFaderOptions {
  cancelFrame?: (handle: number) => void;
  now?: () => number;
  requestFrame?: (callback: () => void) => number;
}

/**
 * Fades the music player's cue gain on animation frames (CIN6 music steps, script `playMusic` / `stopMusic`).
 * A new change cancels the running fade and continues from the gain it reached.
 */
export const createMusicCueFader = (options: MusicCueFaderOptions = {}) => {
  const now = options.now ?? (() => performance.now());
  const requestFrame = options.requestFrame ?? (callback => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? (handle => cancelAnimationFrame(handle));
  let frame: number | null = null;
  let gain = 1;

  const cancelRamp = () => {
    if (frame !== null) cancelFrame(frame);
    frame = null;
  };

  const setGain = (target: MusicCueTarget, value: number) => {
    gain = value;
    target.setCueGain(value);
  };

  /** Ramps the cue gain from its current value to `to` over `durationMs`, then runs `done`. */
  const ramp = (target: MusicCueTarget, to: number, durationMs: number, done?: () => void) => {
    cancelRamp();
    const from = gain, startedAt = now();
    const tick = () => {
      const progress = durationMs > 0 ? clamp01((now() - startedAt) / durationMs) : 1;
      setGain(target, lerp(from, to, progress));
      if (progress < 1) {
        frame = requestFrame(tick);
        return;
      }
      frame = null;
      done?.();
    };
    tick();
  };

  const switchMusic = (target: MusicCueTarget, change: MusicCueChange) => {
    if (!change.start) {
      target.stop();
      setGain(target, 1);
      return;
    }
    setGain(target, 0);
    if (!change.start()) {
      setGain(target, 1);
      return;
    }
    ramp(target, clamp01(change.gain), change.fadeInMs);
  };

  return {
    change: (target: MusicCueTarget, change: MusicCueChange) => {
      if (!target.playing() || change.fadeOutMs <= 0) {
        cancelRamp();
        switchMusic(target, change);
        return;
      }
      ramp(target, 0, change.fadeOutMs, () => switchMusic(target, change));
    },
    dispose: cancelRamp
  };
};

export type MusicCueFader = ReturnType<typeof createMusicCueFader>;
