import { garrisonSlots, garrisonWindowFrame } from "../../src/render-common/buildings/military-garrison-slots";
import type { WindowSoldierFrame } from "../../src/render-common/buildings/military-window-slots";
import {
  WINDOW_HEAD_SIDE_TOLERANCE, WINDOW_SOLDIER_HEAD_ENVELOPES, type WindowSoldierFit, windowSoldierHeadBounds,
  type WindowSoldierRank
} from "../../src/render-common/buildings/window-soldier-head-envelope";
import { WINDOW_HEAD_CENTRE_MARGIN } from "../../src/render-common/buildings/window-soldier-lean-fit";
import { windowSoldierPose } from "../../src/render-common/buildings/window-soldier-pose";
import type { WorkerNation } from "../../src/render-common/workers/worker-unit";

/** Military types whose windows host garrison soldiers. */
export const WINDOW_SOLDIER_TYPES = [1, 2, 4, 9];
export const WINDOW_SOLDIER_NATIONS: WorkerNation[] = [
  "roman", "viking", "nubian", "japanese", "chinese", "persian", "maya", "indigenous"
];
export const WINDOW_SOLDIER_RANKS: WindowSoldierRank[] = ["recruit", "soldier", "centurion"];

export interface WindowSoldierAuditRow {
  detailed: boolean; fits: boolean; headBackProud: number; headCentreProud: number;
  helmetBottomClearance: number; helmetTopClearance: number; index: number; intersects: boolean; lean: number;
  lowerBodyClearance: number; nation: WorkerNation; openingHeight: number; openingWidth: number;
  rank: WindowSoldierRank; reasons: string[]; sideClearance: number; type: number;
}

/** Smallest gap (world units) between the wall faces under the sill and the drawn torso front. */
const lowerBodyClearance = (frame: WindowSoldierFrame, fit: WindowSoldierFit) => Math.min(...frame.wallProfile.map(
  ({ front, y }) => front - (fit.feetOutward + (y - fit.rootY) * Math.tan(fit.lean) +
    frame.lowerBodyDepth / Math.cos(fit.lean))));

/** Measures one drawn window soldier against its real opening; `reasons` lists every intersection. */
export const auditWindowSoldier = (
  frame: WindowSoldierFrame, fit: WindowSoldierFit, nation: WorkerNation, rank: WindowSoldierRank
) => {
  const bounds = windowSoldierHeadBounds(WINDOW_SOLDIER_HEAD_ENVELOPES[nation][rank], fit);
  const metrics = {
    headBackProud: bounds.back - frame.insertFront, headCentreProud: bounds.headOutward - frame.insertFront,
    helmetBottomClearance: bounds.bottom - frame.sill, helmetTopClearance: frame.lintel - bounds.top,
    lowerBodyClearance: lowerBodyClearance(frame, fit), sideClearance: fit.sideClearance
  };
  const reasons: string[] = [];
  if (metrics.helmetTopClearance < -1e-6) reasons.push("helmet above lintel (in the wall)");
  if (metrics.helmetBottomClearance < -1e-6) reasons.push("head below sill");
  if (metrics.sideClearance < -WINDOW_HEAD_SIDE_TOLERANCE) reasons.push("helmet wider than opening");
  if (metrics.lowerBodyClearance < -1e-6) reasons.push("body in front of wall below sill");
  if (metrics.headCentreProud < WINDOW_HEAD_CENTRE_MARGIN - 1e-6) reasons.push("head behind window insert");
  return { ...metrics, reasons };
};

/** Every window slot of the given nations, both presets and every armour rank. */
export const windowSoldierAudit = (nations: readonly WorkerNation[] = WINDOW_SOLDIER_NATIONS) => {
  const rows: WindowSoldierAuditRow[] = [];
  for (const nation of nations) for (const detailed of [true, false]) for (const type of WINDOW_SOLDIER_TYPES) {
    const slots = garrisonSlots(type, nation, detailed).filter(slot => slot.kind === "window");
    for (const [index, slot] of slots.entries()) for (const rank of WINDOW_SOLDIER_RANKS) {
      const frame = garrisonWindowFrame(slot)!;
      const fit = windowSoldierPose(frame, nation, rank);
      const audit = auditWindowSoldier(frame, fit, nation, rank);
      rows.push({ ...audit, detailed, fits: fit.fits, index, intersects: audit.reasons.length > 0, lean: fit.lean,
        nation, openingHeight: frame.lintel - frame.sill, openingWidth: frame.openingWidth, rank, type });
    }
  }
  return rows;
};
