import { isFiniteNumber, isSaveInteger, isSaveObject } from "./save-validation";
import type { SettlementActor, SettlementContext } from "./settlement-types";

interface Budget {
  elapsed: number;
  clock: number;
  remaining: number;
  serial: number;
  waiting: Map<SettlementActor, { serial: number; seen: number }>;
  reserved: Set<SettlementActor>;
  grants: number;
  deferred: number;
}
/**
 * The budget's window phase, clock, queue and reservations (by actor uid), saved exactly: a reload resumes the
 * same grant windows as the uninterrupted island (AI-RELOAD-DRIFT). The grant/defer counters are metrics only.
 */
export interface SavedNavigationRepairBudget {
  clock: number;
  elapsed: number;
  remaining: number;
  reserved: number[];
  serial: number;
  /** [actor uid, request serial, clock when last seen]. */
  waiting: [number, number, number][];
}
const budgets = new WeakMap<SettlementContext, Budget>();
const freshBudget = (): Budget => ({
  elapsed: 0,
  clock: 0,
  remaining: 2,
  serial: 0,
  waiting: new Map(),
  reserved: new Set(),
  grants: 0,
  deferred: 0
});
const getBudget = (context: SettlementContext) => {
  let budget = budgets.get(context);
  if (!budget) {
    budget = freshBudget();
    budgets.set(context, budget);
  }
  return budget;
};
/** Globally bounded repair searches, aged FIFO so actor-array order cannot monopolize grants. */
export const beginNavigationRepairTick = (context: SettlementContext, dt: number) => {
  const budget = getBudget(context);
  budget.elapsed += dt;
  budget.clock += dt;
  if (budget.elapsed + 1e-8 < 0.25) return;
  budget.elapsed %= 0.25;
  budget.remaining = 2;
  budget.reserved.clear();
  for (const [actor, request] of [...budget.waiting].sort((a, b) => a[1].serial - b[1].serial)) {
    if (
      budget.clock - request.seen > 1.25 ||
      !actor.visible ||
      actor.phase === "retired" ||
      actor.pathIndex >= actor.path.length
    ) {
      budget.waiting.delete(actor);
      continue;
    }
    budget.reserved.add(actor);
    if (budget.reserved.size === 2) break;
  }
};
export const requestNavigationRepair = (context: SettlementContext, actor: SettlementActor) => {
  const budget = getBudget(context);
  const request = budget.waiting.get(actor);
  if (request) request.seen = budget.clock;
  else budget.waiting.set(actor, { serial: budget.serial++, seen: budget.clock });
  const eligible = !budget.reserved.size || budget.reserved.has(actor);
  if (!budget.remaining || !eligible) {
    budget.deferred++;
    return false;
  }
  budget.remaining--;
  budget.grants++;
  budget.waiting.delete(actor);
  budget.reserved.delete(actor);
  return true;
};
export const navigationRepairMetrics = (context: SettlementContext) => {
  const budget = getBudget(context);
  return { grants: budget.grants, deferred: budget.deferred, pending: budget.waiting.size };
};

export const saveNavigationRepairBudget = (context: SettlementContext): SavedNavigationRepairBudget | undefined => {
  const budget = budgets.get(context);
  if (!budget) return undefined;
  const { clock, elapsed, remaining, serial } = budget;
  return { clock, elapsed, remaining, reserved: [...budget.reserved].map(actor => actor.uid), serial,
    waiting: [...budget.waiting].map(([actor, request]) => [actor.uid, request.serial, request.seen]) };
};

/**
 * Load-time reconciliation may spend repair grants on repositioning; those belong to the restore, so the budget
 * restarts from the save (or empty, for a save without one) once the load is done.
 */
export const restoreNavigationRepairBudget = (context: SettlementContext, saved?: SavedNavigationRepairBudget) => {
  budgets.delete(context);
  if (!saved) return;
  const actors = new Map(context.actors.map(actor => [actor.uid, actor]));
  const budget = { ...freshBudget(), clock: saved.clock, elapsed: saved.elapsed, remaining: saved.remaining,
    serial: saved.serial };
  for (const [uid, serial, seen] of saved.waiting) {
    const actor = actors.get(uid);
    if (actor) budget.waiting.set(actor, { serial, seen });
  }
  for (const uid of saved.reserved) {
    const actor = actors.get(uid);
    if (actor) budget.reserved.add(actor);
  }
  budgets.set(context, budget);
};

const isSaveUid = (value: unknown) => isSaveInteger(value);
const isWaitingEntry = (entry: unknown) => Array.isArray(entry) && entry.length === 3 && isSaveInteger(entry[0]) &&
  isSaveInteger(entry[1]) && isFiniteNumber(entry[2]);

/** Whether `value` is a saved repair budget (absent in saves before format 21). */
export const isSavedNavigationRepairBudget = (value: unknown): value is SavedNavigationRepairBudget =>
  isSaveObject(value) && isFiniteNumber(value.clock) && isFiniteNumber(value.elapsed) &&
  isSaveInteger(value.remaining) && isSaveInteger(value.serial) && Array.isArray(value.reserved) &&
  value.reserved.every(isSaveUid) && Array.isArray(value.waiting) && value.waiting.every(isWaitingEntry);
