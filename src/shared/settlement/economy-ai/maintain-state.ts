import { secondsToTicks } from "../../../../../island-of-settlers-shared/src/time/constants";
import { isFiniteNumber } from "../../../../../island-of-settlers-shared/src/validation/guards";
import { isSaveInteger, isSaveObject } from "../save-validation";

/** A goal of the `maintain` memory that backs off after a refusal (plan §3.5). */
export interface MaintainBackoff {
  /** Refused tries so far: the backoff grows with them. */
  attempts?: number;
  /** The game tick of the next try after a refusal. */
  retryTick?: number;
}

/**
 * One fallen building of a `maintain` faction waiting to be raised again on its original plot (enemy economy AI
 * plan §4.1): copied from the faction's own ruin (BD2), so it outlives the ruin's clearing. Own state only.
 */
export interface MaintainRebuild extends MaintainBackoff {
  rotation: number;
  typeId: number;
  /** The fallen building's uid, which its ruin keeps. */
  uid: number;
  x: number;
  z: number;
}

/** A damaged wall of the faction whose repair was refused (no stock, no way): its backoff (EAI2d). */
export interface MaintainRepair extends MaintainBackoff {
  /** The building's uid. */
  uid: number;
}

/** A faction's `maintain` memory: the plots to rebuild (oldest fall first) and the walls whose repair waits. */
export interface MaintainState {
  rebuilds: MaintainRebuild[];
  repairs: MaintainRepair[];
}

/** What a faction's `maintain` memory saves: absent while nothing waits; each list absent while empty. */
export interface MaintainSave {
  rebuilds?: MaintainRebuild[];
  repairs?: MaintainRepair[];
}

/** Plan §3.5: a refused goal waits 10 s per attempt so far, at most 60 s. */
const RETRY_SECONDS = 10;
const RETRY_CAP_SECONDS = 60;

/** Whether the goal's backoff is over. */
export const isGoalDue = (entry: MaintainBackoff, now: number) =>
  entry.retryTick === undefined || entry.retryTick <= now;

/** One more refusal: the goal waits 10 s × attempts, at most 60 s, in game ticks. */
export const backOffGoal = (entry: MaintainBackoff, now: number) => {
  const attempts = (entry.attempts ?? 0) + 1;
  entry.attempts = attempts;
  entry.retryTick = now + secondsToTicks(Math.min(RETRY_CAP_SECONDS, RETRY_SECONDS * attempts));
};

/** Drops a goal from its list. */
export const forgetGoal = <Goal>(goals: Goal[], entry: Goal) => {
  const index = goals.indexOf(entry);
  if (index >= 0) goals.splice(index, 1);
};

const INVALID_MAINTAIN_SAVE = "Invalid maintain state";

export const createMaintainState = (): MaintainState => ({ rebuilds: [], repairs: [] });

const copyBackoff = ({ attempts, retryTick }: MaintainBackoff): MaintainBackoff => ({
  ...(attempts === undefined ? {} : { attempts }), ...(retryTick === undefined ? {} : { retryTick })
});

const copyRebuild = (entry: MaintainRebuild): MaintainRebuild => {
  const { rotation, typeId, uid, x, z } = entry;
  return { ...copyBackoff(entry), rotation, typeId, uid, x, z };
};

const copyRepair = (entry: MaintainRepair): MaintainRepair => ({ ...copyBackoff(entry), uid: entry.uid });

/** A plain copy for the save; undefined while nothing waits, so a faction without losses saves nothing. */
export const saveMaintainState = ({ rebuilds, repairs }: MaintainState): MaintainSave | undefined => {
  if (!rebuilds.length && !repairs.length) return undefined;
  return {
    ...(rebuilds.length ? { rebuilds: rebuilds.map(copyRebuild) } : {}),
    ...(repairs.length ? { repairs: repairs.map(copyRepair) } : {})
  };
};

/** A load: the saved goals, or none. */
export const restoreMaintainState = (state: MaintainState, saved: MaintainSave | undefined) => {
  state.rebuilds.length = 0;
  state.repairs.length = 0;
  for (const entry of saved?.rebuilds ?? []) state.rebuilds.push(copyRebuild(entry));
  for (const entry of saved?.repairs ?? []) state.repairs.push(copyRepair(entry));
};

const optionalCount = (value: unknown, minimum: number) => value === undefined || isSaveInteger(value, minimum);

const validBackoff = (value: Record<string, unknown>) => isSaveInteger(value.uid) &&
  optionalCount(value.attempts, 1) && optionalCount(value.retryTick, 0);

const validRebuild = (value: unknown) => isSaveObject(value) && validBackoff(value) &&
  isSaveInteger(value.typeId) && Number.isSafeInteger(value.rotation) && isFiniteNumber(value.x) &&
  isFiniteNumber(value.z);

const validRepair = (value: unknown) => isSaveObject(value) && validBackoff(value);

/** A saved goal list: absent, or non-empty valid entries with unique uids. */
const validGoals = (goals: unknown, valid: (value: unknown) => boolean) => {
  if (goals === undefined) return true;
  if (!Array.isArray(goals) || !goals.length || !goals.every(valid)) return false;
  return new Set(goals.map(entry => (entry as MaintainBackoff & { uid: number }).uid)).size === goals.length;
};

/** Why a saved `maintain` memory is refused, or null (absent is valid; one list at least; uids are unique). */
export const maintainSaveError = (saved: unknown) => {
  if (saved === undefined) return null;
  if (!isSaveObject(saved) || (saved.rebuilds === undefined && saved.repairs === undefined))
    return INVALID_MAINTAIN_SAVE;
  const valid = validGoals(saved.rebuilds, validRebuild) && validGoals(saved.repairs, validRepair);
  return valid ? null : INVALID_MAINTAIN_SAVE;
};
