import { WORKER_RADIUS } from "../../render-common/workers/worker-dimensions";
import { deterministicPow } from "../math/deterministic-math";
import type { FieldState } from "./settlement-field-cycles";

/** Horizontal radius of the earth clamp and its timber stack. */
export const CHARCOAL_MOUND_RADIUS = 0.38;
/** Full-height vertical scale of the clamp sphere; its lower half stays below ground. */
export const CHARCOAL_MOUND_FULL_SCALE_Y = 0.65;
/** Full clamp centre and ground-anchored bottom/top, shared by staging and worker clearance. */
export const CHARCOAL_MOUND_CENTER_Y = 0.12;
const MOUND_VERTICAL_RADIUS = CHARCOAL_MOUND_RADIUS * CHARCOAL_MOUND_FULL_SCALE_Y;
export const CHARCOAL_MOUND_BOTTOM_Y = CHARCOAL_MOUND_CENTER_Y - MOUND_VERTICAL_RADIUS;
export const CHARCOAL_MOUND_TOP_Y = CHARCOAL_MOUND_CENTER_Y + MOUND_VERTICAL_RADIUS;
/** Keeps the worker's body clear of the clamp, while the shovel still reaches its edge. */
const CHARCOAL_WORK_MARGIN = 0.1;
export const CHARCOAL_WORK_STAND_OFF =
  CHARCOAL_MOUND_RADIUS + WORKER_RADIUS + CHARCOAL_WORK_MARGIN;
/** Lowest puff starts above the clamp so no grey sphere grows out of the mound. */
export const CHARCOAL_SMOKE_START_Y = CHARCOAL_MOUND_TOP_Y + 0.1;
const CHARCOAL_COVER_VISITS = 6;
/** Logs lie in two supported layers: three at the base, three above. */
export const CHARCOAL_LOG_RADIUS = 0.075;
export const CHARCOAL_LOG_HALF_LENGTH = 0.325;
export const CHARCOAL_LOG_LAYOUT = [
  { y: 0.09, z: -0.12 },
  { y: 0.09, z: 0 },
  { y: 0.09, z: 0.12 },
  { y: 0.2, z: -0.12 },
  { y: 0.2, z: 0 },
  { y: 0.2, z: 0.12 }
] as const;

/** Earth is mounded slowly at first so early cover visits stay below the log crowns. */
const COVER_GROWTH_EXPONENT = 1.6;
const COAL_MIN_REMAINING_SCALE = 0.35;

/** 0..1 earth cover. Building visits alternate: even add a log, odd cover the clamp. */
const charcoalCoverProgress = (state: FieldState, step: number) => {
  if (state === "stubble") return 0;
  if (state !== "building") return 1;
  const coveredVisits = Math.min(CHARCOAL_COVER_VISITS, Math.ceil(step / 2));
  return deterministicPow(coveredVisits / CHARCOAL_COVER_VISITS, COVER_GROWTH_EXPONENT);
};
const loadedLogCount = (step: number) =>
  Math.min(CHARCOAL_LOG_LAYOUT.length, Math.floor(step / 2) + 1);
const charcoalMoundScaleY = (state: FieldState, step: number) => {
  if (state === "coal") {
    return CHARCOAL_MOUND_FULL_SCALE_Y * Math.max(COAL_MIN_REMAINING_SCALE, 1 - step / 6);
  }
  return CHARCOAL_MOUND_FULL_SCALE_Y * charcoalCoverProgress(state, step);
};
/** The sphere bottom stays on the clamp base while its height grows or the coal heap shrinks. */
const charcoalMoundCenterY = (scaleY: number) =>
  CHARCOAL_MOUND_BOTTOM_Y + CHARCOAL_MOUND_RADIUS * scaleY;
export const charcoalMoundTopY = (scaleY: number) =>
  CHARCOAL_MOUND_BOTTOM_Y + 2 * CHARCOAL_MOUND_RADIUS * scaleY;

export interface CharcoalStageVisual {
  coalMaterial: boolean;
  logs: readonly boolean[];
  logsVisible: boolean;
  moundCenterY: number;
  moundScaleY: number;
  moundVisible: boolean;
  smokeVisible: boolean;
}
/** Pure stage mapping; the renderer only applies these values to its cached meshes. */
export const charcoalStageVisual = (state: FieldState, step: number): CharcoalStageVisual => {
  const moundScaleY = charcoalMoundScaleY(state, step);
  const moundTop = charcoalMoundTopY(moundScaleY);
  const logCount = state === "building" ? loadedLogCount(step) : 0;
  const logs = CHARCOAL_LOG_LAYOUT.map((log, index) =>
    index < logCount && log.y + CHARCOAL_LOG_RADIUS > moundTop + 0.01);
  return {
    coalMaterial: state === "coal",
    logs,
    logsVisible: logCount > 0,
    moundCenterY: charcoalMoundCenterY(moundScaleY),
    moundScaleY,
    moundVisible: state !== "stubble" && moundTop > 0,
    smokeVisible: state === "burning"
  };
};
