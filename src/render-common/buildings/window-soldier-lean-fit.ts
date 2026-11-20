import { DMath } from "../../shared/math/deterministic-math";
import type { WindowSoldierFrame } from "./military-window-slots";
import {
  WINDOW_HEAD_SIDE_TOLERANCE, WINDOW_HEAD_VERTICAL_CLEARANCE, WINDOW_POSE_STEP, WINDOW_SILL_CLEARANCE,
  type WindowSoldierFit, windowSoldierHeadCentre, windowSoldierHeadCorners, type WindowSoldierHeadEnvelope
} from "./window-soldier-head-envelope";

/** Gentlest root lean tried (radians). */
const MIN_WINDOW_LEAN = .1;
/** Steepest root lean (radians): beyond this the soldier reads as falling out of the window. */
const MAX_WINDOW_LEAN = .85;
/** Least acceptable: the head centre stands this far (world units) in front of the window insert. */
export const WINDOW_HEAD_CENTRE_MARGIN = .03;
/** Shoulder joints above the feet (world units) of the upright worker figure. */
const SHOULDER_HEIGHT = .8;
/** Highest the shoulders stand above the sill: the folded forearms must still reach down onto it. */
const SHOULDER_ABOVE_SILL = .2;

interface LeanTrial { bottom: number; feetOutward: number; headBack: number; headCentre: number; rootY: number }

/**
 * One lean angle: the helmet stays under the lintel, the shoulders within forearm reach of the sill,
 * and the feet stand as far out as the wall allows: at every sampled height under the sill (sill
 * block, surround rail, wall, plinth) the torso front stays just behind the frontmost face, so the
 * wall hides everything below.
 */
const trialLean = (frame: WindowSoldierFrame, envelope: WindowSoldierHeadEnvelope, lean: number): LeanTrial => {
  const cos = DMath.cos(lean), tan = DMath.tan(lean);
  const corners = windowSoldierHeadCorners(envelope, lean);
  // Under the lintel, and low enough in a tall window for the forearms to rest on the sill.
  const rootY = Math.min(frame.lintel - WINDOW_HEAD_VERTICAL_CLEARANCE - Math.max(...corners.map(corner => corner.y)),
    frame.sill + SHOULDER_ABOVE_SILL - SHOULDER_HEIGHT * cos);
  const feetOutward = Math.min(...frame.wallProfile.map(({ front, y }) =>
    front - WINDOW_SILL_CLEARANCE - (y - rootY) * tan - frame.lowerBodyDepth / cos));
  return { bottom: rootY + Math.min(...corners.map(corner => corner.y)), feetOutward,
    headBack: feetOutward + Math.min(...corners.map(corner => corner.u)),
    headCentre: feetOutward + windowSoldierHeadCentre(envelope, lean).u, rootY };
};

/** Gentlest lean whose trial satisfies `accept` with the head above the sill. */
const gentlestLean = (
  frame: WindowSoldierFrame, envelope: WindowSoldierHeadEnvelope, accept: (trial: LeanTrial) => boolean
) => {
  const minimumBottom = frame.sill + WINDOW_HEAD_VERTICAL_CLEARANCE;
  for (let lean = MIN_WINDOW_LEAN; lean <= MAX_WINDOW_LEAN + 1e-9; lean += WINDOW_POSE_STEP) {
    const trial = trialLean(frame, envelope, lean);
    if (trial.bottom >= minimumBottom && accept(trial)) return { lean, trial };
  }
  return undefined;
};

/**
 * Fits a soldier leaning out of a window: the whole figure tilts about the feet, the helmet top stays
 * under the lintel and the torso stays behind the wall under the sill, so only the legs are hidden.
 * The head, face, shoulders and chest stand in front of the recessed window insert, never behind it.
 * The gentlest lean that brings the whole head in front of the insert wins; otherwise the gentlest
 * one with the head centre in front of it. A window too small for either keeps the head centre in
 * front at the steepest lean; `fits` is then false (the torso shows just under the sill).
 */
export const windowSoldierLeanFit = (
  frame: WindowSoldierFrame, envelope: WindowSoldierHeadEnvelope
): WindowSoldierFit => {
  const sideClearance = frame.openingWidth / 2 - envelope.halfWidth;
  const sideFits = sideClearance >= -WINDOW_HEAD_SIDE_TOLERANCE;
  const insert = frame.insertFront + WINDOW_SILL_CLEARANCE;
  const chosen = gentlestLean(frame, envelope, trial => trial.headBack >= insert) ??
    gentlestLean(frame, envelope, trial => trial.headCentre >= insert + WINDOW_HEAD_CENTRE_MARGIN);
  if (chosen) {
    const { lean, trial: { feetOutward, rootY } } = chosen;
    return { feetOutward, fits: sideFits, lean, rootY, sideClearance };
  }
  const steepest = trialLean(frame, envelope, MAX_WINDOW_LEAN);
  const lift = Math.max(0, insert + WINDOW_HEAD_CENTRE_MARGIN - steepest.headCentre);
  return { feetOutward: steepest.feetOutward + lift, fits: false, lean: MAX_WINDOW_LEAN, rootY: steepest.rootY,
    sideClearance };
};
