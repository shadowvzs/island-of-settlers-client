import { isFiniteNumber } from "../../../../../island-of-settlers-shared/src/validation/guards";
import {
  arrayOf, checkValue, guard, integer, objectOf, optional
} from "../../../../../island-of-settlers-shared/src/validation/index";
import {
  INT32_MAX, INT32_MIN, PLANNER_FULL_CHECKS, PLANNER_PENDING_ROAD_VALUES, PLANNER_STAGE_CHECK, PLANNER_STAGE_PLACE,
  PLOT_MEMO_CAPACITY
} from "./constants";
import { createPlotMemo, type PlotMemo, type PlotMemoRecord, restoreMemo, saveMemo } from "./plot-memo";

/**
 * A planner decision's placement still running, one step per tick (`planner-placement.ts`): the ranked
 * candidates still waiting (cache entries, the first is current), the checked road plan's points as x, z pairs
 * (empty until found, or when the flag already joins), the step and the type.
 */
export interface PlannerPending {
  candidates: number[];
  road: number[];
  stage: number;
  typeId: number;
}

/** A `develop` faction's build planner memory (plan §3.5); the goal and its backoff are the strategic layer's. */
export interface PlannerState {
  readonly memo: PlotMemo;
  pending?: PlannerPending;
}

/** What the planner saves; absent while it remembers nothing. */
export interface PlannerSave {
  memo?: PlotMemoRecord[];
  pending?: PlannerPending;
}

const plannerSaveCheck = objectOf({
  memo: optional(arrayOf(objectOf({ entry: integer(0, INT32_MAX), expires: integer(0),
    fingerprint: integer(INT32_MIN, INT32_MAX), typeId: integer(0, INT32_MAX) }), PLOT_MEMO_CAPACITY)),
  pending: optional(objectOf({
    candidates: arrayOf(integer(0, INT32_MAX), PLANNER_FULL_CHECKS),
    road: arrayOf(guard(value => isFiniteNumber(value)), PLANNER_PENDING_ROAD_VALUES),
    stage: integer(PLANNER_STAGE_CHECK, PLANNER_STAGE_PLACE), typeId: integer(0, INT32_MAX)
  }))
});

export const createPlannerState = (): PlannerState => ({ memo: createPlotMemo() });

const copyPending = ({ candidates, road, stage, typeId }: PlannerPending): PlannerPending =>
  ({ candidates: [...candidates], road: [...road], stage, typeId });

/** A plain copy for the save; undefined while the memo holds no record and no placement waits. */
export const savePlannerState = (state: PlannerState): PlannerSave | undefined => {
  if (!state.memo.count && !state.pending) return undefined;
  return { ...(state.memo.count ? { memo: saveMemo(state.memo) } : {}),
    ...(state.pending ? { pending: copyPending(state.pending) } : {}) };
};

/** A load (or a fresh start with `undefined`): the saved memo and waiting placement. */
export const restorePlannerState = (state: PlannerState, saved: PlannerSave | undefined) => {
  restoreMemo(state.memo, saved?.memo);
  state.pending = saved?.pending && copyPending(saved.pending);
};

/** Null when a saved planner memory is well formed (absent is valid). */
export const plannerSaveError = (saved: unknown) =>
  saved === undefined || !checkValue(plannerSaveCheck, saved).length ? null : "Invalid planner state";
