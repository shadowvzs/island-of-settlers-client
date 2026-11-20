import type { WorkerNation } from "../workers/worker-unit";
import type { WindowSoldierFrame } from "./military-window-slots";
import {
  WINDOW_SOLDIER_HEAD_ENVELOPES, type WindowSoldierFit, type WindowSoldierRank
} from "./window-soldier-head-envelope";
import { windowSoldierLeanFit } from "./window-soldier-lean-fit";

const fits = new WeakMap<WindowSoldierFrame, Map<string, WindowSoldierFit>>();

/**
 * Presentation pose of a window soldier, cached per window, nation and armour rank (the frame is
 * cached with its slot, so a fit is computed once, never per frame).
 */
export const windowSoldierPose = (
  frame: WindowSoldierFrame, nation: WorkerNation, rank: WindowSoldierRank
): WindowSoldierFit => {
  let byKey = fits.get(frame);
  if (!byKey) { byKey = new Map(); fits.set(frame, byKey); }
  const key = `${nation}:${rank}`;
  const cached = byKey.get(key);
  if (cached) return cached;
  const fit = windowSoldierLeanFit(frame, WINDOW_SOLDIER_HEAD_ENVELOPES[nation][rank]);
  byKey.set(key, fit);
  return fit;
};
