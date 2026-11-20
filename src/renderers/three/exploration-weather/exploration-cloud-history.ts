/**
 * When and how strongly the possessed-sky cloud pass reuses its temporal history. A restart shows
 * one frame of raw march jitter that the history needs many frames to calm again (the "champagne"
 * fizz on cloud edges, owner bug 2026-11-13), so only a gap the history cannot bridge restarts it.
 * The history must also never hold more than a fraction of a second of motion: kept for ~20 slow
 * frames it smeared drifting clouds into radial streaks (owner captures/12.png, 2026-11-13).
 */

import { EXPLORATION_CLOUD_HISTORY } from "../../../render-common/atmosphere/exploration-sky-constants";

/** Highest history share per frame (60 fps and faster): ~20 frames of jitter averaged. */
export const CLOUD_HISTORY_WEIGHT = EXPLORATION_CLOUD_HISTORY.weight;
/**
 * The history's time constant: half a second of motion at most, whatever the frame rate. 60 fps
 * keeps CLOUD_HISTORY_WEIGHT, 15 fps 0.88 (about the former fixed 0.9), a 250 ms frame 0.61.
 */
export const CLOUD_HISTORY_TIME_CONSTANT_MS = EXPLORATION_CLOUD_HISTORY.timeConstantMs;
/** A render gap this long (possession suspended, tab hidden) restarts the history. */
export const CLOUD_HISTORY_GAP_MS = EXPLORATION_CLOUD_HISTORY.gapMs;

/**
 * The history weight of a frame `gapMs` after the previous cloud render (0: restart). Frame-rate
 * independent: the history fades by time, so a weak device averages fewer frames instead of
 * keeping seconds of cloud drift and camera motion.
 */
export const cloudHistoryWeight = (gapMs: number) => {
  if (!Number.isFinite(gapMs) || gapMs < 0 || gapMs > CLOUD_HISTORY_GAP_MS) return 0;
  return Math.min(CLOUD_HISTORY_WEIGHT, Math.exp(-gapMs / CLOUD_HISTORY_TIME_CONSTANT_MS));
};

/**
 * Lower-layer drift since the previous cloud render (`previous` is updated in place). The resolve
 * moves the history by it, so wind-driven clouds are reprojected instead of smeared.
 */
export const advanceCloudDrift = (drift: ArrayLike<number>, previous: Float32Array, delta: Float32Array) => {
  const x = Number.isFinite(drift[0]) ? drift[0]! : 0;
  const z = Number.isFinite(drift[1]) ? drift[1]! : 0;
  delta[0] = x - previous[0]!;
  delta[1] = z - previous[1]!;
  previous[0] = x;
  previous[1] = z;
  return delta;
};
