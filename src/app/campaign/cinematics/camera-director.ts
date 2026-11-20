/**
 * CIN3 camera director: the cinematic camera of one sequence on the presentation clock. It never writes the RTS
 * `CameraState`; it only produces the override pose (blend 1), the hand-back blend (1 -> 0 over the camera drawn
 * underneath: the untouched RTS rig or the suspended possessed eye) and the shake offset.
 */
import { easeProgress, orbitToPose } from "../../../render-common/cinematic/camera-orbit";
import type { CameraOrbit, CinematicFrame, CinematicShake } from "../../../render-common/cinematic/cinematic-frame";
import { type CameraMove, evaluateCameraTrack, shakeOffset } from "./camera-track";
import { MS_PER_SECOND } from "./constants";

interface ActiveMove {
  from: CameraOrbit;
  move: CameraMove;
  startMs: number;
}

interface TimedSpan {
  durationMs: number;
  startMs: number;
}

interface ActiveShake extends TimedSpan {
  strength: number;
}

export type CinematicCameraFrame = Pick<CinematicFrame, "camera" | "focusDistance" | "shake">;

const progressOf = (span: TimedSpan, nowMs: number) =>
  span.durationMs > 0 ? (nowMs - span.startMs) / span.durationMs : 1;

export const createCameraDirector = () => {
  let active: ActiveMove | null = null;
  let restore: TimedSpan | null = null;
  let shake: ActiveShake | null = null;

  const orbitAt = (nowMs: number) => {
    if (!active) return null;
    return evaluateCameraTrack(active.from, [active.move], nowMs - active.startMs);
  };

  /** A camera step: from where the camera is now (or the drawn pose for the first one) to the shot. */
  const moveTo = (move: CameraMove, startMs: number, drawnOrbit: () => CameraOrbit | null) => {
    const from = orbitAt(startMs) ?? drawnOrbit() ?? move.to;
    active = { from, move, startMs };
    restore = null;
  };

  /** Hands the view back over `durationMs`: the override fades onto the camera drawn underneath. */
  const restoreOver = (durationMs: number, startMs: number) => {
    if (!active || restore) return;
    restore = { durationMs, startMs };
  };

  const blendAt = (nowMs: number) => {
    if (!restore) return 1;
    return 1 - easeProgress("easeInOut", progressOf(restore, nowMs));
  };

  const shakeAt = (nowMs: number): CinematicShake | null => {
    if (!shake) return null;
    const progress = progressOf(shake, nowMs);
    if (progress >= 1) return null;
    return shakeOffset(shake.strength, progress, nowMs / MS_PER_SECOND);
  };

  const frame = (nowMs: number): CinematicCameraFrame => {
    const orbit = orbitAt(nowMs);
    const blend = blendAt(nowMs);
    const shaking = shakeAt(nowMs);
    if (!orbit || blend <= 0) return { camera: null, focusDistance: 0, shake: shaking };
    return { camera: { blend, pose: orbitToPose(orbit) }, focusDistance: orbit.distance, shake: shaking };
  };

  return {
    /** The override is gone (never set, or fully handed back). */
    released: (nowMs: number) => !active || (restore !== null && progressOf(restore, nowMs) >= 1),
    frame,
    moveTo,
    orbitAt,
    reset: () => {
      active = null;
      restore = null;
      shake = null;
    },
    restoreOver,
    shake: (strength: number, durationMs: number, startMs: number) => {
      shake = { durationMs, startMs, strength };
    },
    stopShake: () => { shake = null; }
  };
};

export type CameraDirector = ReturnType<typeof createCameraDirector>;
