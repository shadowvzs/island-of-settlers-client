import { isFiniteNumber, isSaveInteger, isSaveObject, isSavePoint } from "./save-validation";
import {
  restoreObstacleDetourWaits, type SavedObstacleDetourWait, saveObstacleDetourWaits
} from "./settlement-obstacle-detours";
import {
  isSavedNavigationRepairBudget, restoreNavigationRepairBudget, type SavedNavigationRepairBudget,
  saveNavigationRepairBudget
} from "./settlement-repair-budget";
import {
  restoreRoadTravelChecks, type SavedRoadTravelCheck, saveRoadTravelChecks
} from "./settlement-road-rerouting";
import type { SettlementContext } from "./settlement-types";
import { restoreYieldBudgets, type SavedYieldBudget, saveYieldBudgets } from "./settlement-yield-budget";

/**
 * AI-RELOAD-DRIFT (format 21): movement memories a reload must resume to step like the uninterrupted island: the
 * route repair grant windows, the walkers' obstacle detour waits, their pending road checks and their proactive
 * sidestep budgets. Unsaved, a reload opened a fresh grant window at the load tick (a stalled walker repaired its
 * route a tick earlier or later), forgot a road edit made while a carrier stood inside a storage (it kept the old
 * route) and let a walker anticipate a crowd it had stopped anticipating. Absent in older saves: as before, the
 * budget starts empty, nobody waits, every journey counts as checked and no sidesteps are counted.
 */
export interface SavedMovementResume {
  budget?: SavedNavigationRepairBudget;
  detourWaits?: SavedObstacleDetourWait[];
  roadChecks?: SavedRoadTravelCheck[];
  yieldBudgets?: SavedYieldBudget[];
}

export const saveMovementResume = (context: SettlementContext): SavedMovementResume | undefined => {
  const budget = saveNavigationRepairBudget(context), detourWaits = saveObstacleDetourWaits(context);
  const roadChecks = saveRoadTravelChecks(context), yieldBudgets = saveYieldBudgets(context.actors);
  if (!budget && !detourWaits.length && !roadChecks.length && !yieldBudgets.length) return undefined;
  return { ...(budget ? { budget } : {}), ...(detourWaits.length ? { detourWaits } : {}),
    ...(roadChecks.length ? { roadChecks } : {}), ...(yieldBudgets.length ? { yieldBudgets } : {}) };
};

/** Runs after the load's own reconciliation, whose repair grants belong to the restore. */
export const restoreMovementResume = (context: SettlementContext, saved?: SavedMovementResume) => {
  restoreNavigationRepairBudget(context, saved?.budget);
  restoreObstacleDetourWaits(context, saved?.detourWaits);
  restoreRoadTravelChecks(context, saved?.roadChecks);
  restoreYieldBudgets(context.actors, saved?.yieldBudgets);
};

/** Drops the records of actors a save edit removed (offline raid victims). */
export const withoutMovementResumeActors = (
  saved: SavedMovementResume | undefined, removed: ReadonlySet<number>
): SavedMovementResume | undefined => {
  if (!saved) return undefined;
  const { budget, detourWaits, roadChecks, yieldBudgets } = saved;
  return {
    ...(budget ? { budget: { ...budget, reserved: budget.reserved.filter(uid => !removed.has(uid)),
      waiting: budget.waiting.filter(([uid]) => !removed.has(uid)) } } : {}),
    ...(detourWaits ? { detourWaits: detourWaits.filter(([uid]) => !removed.has(uid)) } : {}),
    ...(roadChecks ? { roadChecks: roadChecks.filter(check => !removed.has(check.actor)) } : {}),
    ...(yieldBudgets ? { yieldBudgets: yieldBudgets.filter(([uid]) => !removed.has(uid)) } : {})
  };
};

const isDetourWait = (entry: unknown) => Array.isArray(entry) && entry.length === 2 && isSaveInteger(entry[0]) &&
  isFiniteNumber(entry[1]) && entry[1] > 0;

const isTrueFlag = (value: unknown) => value === undefined || value === true;
const isRoadCheck = (entry: unknown) => isSaveObject(entry) && isSaveInteger(entry.actor) &&
  isTrueFlag(entry.blocked) && isTrueFlag(entry.replaced) && isTrueFlag(entry.stale) &&
  (entry.destination === undefined || isSavePoint(entry.destination));

const isYieldBudget = (entry: unknown) => Array.isArray(entry) && entry.length === 5 && isSaveInteger(entry[0]) &&
  isSaveInteger(entry[1]) && isSaveInteger(entry[2]) && isFiniteNumber(entry[3]) && isFiniteNumber(entry[4]);

/** Why a saved `movementResume` block is invalid, or null. */
export const movementResumeProblem = (value: unknown, actorUids: ReadonlySet<number>) => {
  if (value === undefined) return null;
  if (!isSaveObject(value)) return "Invalid movement resume";
  const { budget, detourWaits, roadChecks, yieldBudgets } = value;
  if (budget !== undefined && !isSavedNavigationRepairBudget(budget)) return "Invalid navigation repair budget";
  if (detourWaits !== undefined && (!Array.isArray(detourWaits) || !detourWaits.every(isDetourWait)))
    return "Invalid obstacle detour waits";
  if (roadChecks !== undefined && (!Array.isArray(roadChecks) || !roadChecks.every(isRoadCheck)))
    return "Invalid road travel checks";
  if (yieldBudgets !== undefined && (!Array.isArray(yieldBudgets) || !yieldBudgets.every(isYieldBudget)))
    return "Invalid yield budgets";
  const uids = [...budget?.reserved ?? [], ...budget?.waiting.map(([uid]) => uid) ?? [],
    ...(detourWaits as SavedObstacleDetourWait[] | undefined)?.map(([uid]) => uid) ?? [],
    ...(roadChecks as SavedRoadTravelCheck[] | undefined)?.map(check => check.actor) ?? [],
    ...(yieldBudgets as SavedYieldBudget[] | undefined)?.map(([uid]) => uid) ?? []];
  return uids.every(uid => actorUids.has(uid)) ? null : "Movement resume names an unknown actor";
};
