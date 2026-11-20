/**
 * A list of camera moves evaluated at a presentation time (CIN2 core of the CIN3 camera director):
 * each move blends from where the previous one ended to its shot, then optionally drifts. Pure.
 */
import {
  applyDrift,
  type CinematicEase,
  driftTarget,
  easeProgress,
  interpolateOrbit,
  type OrbitDrift
} from "../../../render-common/cinematic/camera-orbit";
import type { CameraOrbit, CinematicShake } from "../../../render-common/cinematic/cinematic-frame";
import {
  SHAKE_CHANNEL_OFFSETS,
  SHAKE_FREQUENCIES,
  SHAKE_HARMONIC_PHASE,
  SHAKE_PITCH,
  SHAKE_SHIFT_X,
  SHAKE_SHIFT_Y,
  SHAKE_YAW
} from "./constants";

export interface CameraMoveDrift extends OrbitDrift {
  durationMs: number;
  ease: CinematicEase;
}

export interface CameraMove {
  drift?: CameraMoveDrift;
  ease: CinematicEase;
  to: CameraOrbit;
  transitionMs: number;
}

const moveDuration = (move: CameraMove) => move.transitionMs + (move.drift?.durationMs ?? 0);

export const cameraTrackDuration = (moves: readonly CameraMove[]) =>
  moves.reduce((total, move) => total + moveDuration(move), 0);

/** Where a move leaves the camera (its shot, or the drift's end). */
const moveEnd = (move: CameraMove) => (move.drift ? driftTarget(move.to, move.drift) : move.to);

const evaluateMove = (from: CameraOrbit, move: CameraMove, localMs: number) => {
  if (localMs < move.transitionMs) {
    const progress = move.transitionMs > 0 ? localMs / move.transitionMs : 1;
    return interpolateOrbit(from, move.to, easeProgress(move.ease, progress));
  }
  if (!move.drift) return move.to;
  const driftMs = localMs - move.transitionMs;
  const progress = move.drift.durationMs > 0 ? driftMs / move.drift.durationMs : 1;
  return applyDrift(move.to, move.drift, easeProgress(move.drift.ease, progress));
};

/** The orbit at `timeMs` after the track started from `start`; past the end it holds the last pose. */
export const evaluateCameraTrack = (start: CameraOrbit, moves: readonly CameraMove[], timeMs: number) => {
  let from = start;
  let elapsed = Math.max(0, timeMs);
  for (const move of moves) {
    const duration = moveDuration(move);
    if (elapsed < duration) return evaluateMove(from, move, elapsed);
    elapsed -= duration;
    from = moveEnd(move);
  }
  return from;
};

const wave = (seconds: number, frequencies: readonly number[]) => {
  let sum = 0;
  frequencies.forEach((frequency, index) => {
    sum += Math.sin(seconds * frequency + index * SHAKE_HARMONIC_PHASE);
  });
  return sum / frequencies.length;
};

/**
 * Camera shake for `strength` 0..1 at `progress` 0..1 of its duration: trauma squared (it fades out
 * quickly) times smooth multi-sine noise, so it never pops or repeats visibly.
 */
export const shakeOffset = (strength: number, progress: number, seconds: number): CinematicShake => {
  const trauma = Math.max(0, strength) * Math.max(0, 1 - progress);
  const amount = trauma * trauma;
  return {
    pitch: amount * SHAKE_PITCH * wave(seconds + SHAKE_CHANNEL_OFFSETS.pitch, SHAKE_FREQUENCIES),
    x: amount * SHAKE_SHIFT_X * wave(seconds + SHAKE_CHANNEL_OFFSETS.x, SHAKE_FREQUENCIES),
    y: amount * SHAKE_SHIFT_Y * wave(seconds + SHAKE_CHANNEL_OFFSETS.y, SHAKE_FREQUENCIES),
    yaw: amount * SHAKE_YAW * wave(seconds + SHAKE_CHANNEL_OFFSETS.yaw, SHAKE_FREQUENCIES)
  };
};
