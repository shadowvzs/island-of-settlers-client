import { trafficWork } from "./settlement-traffic-counters";
import type { SettlementActor } from "./settlement-types";

/**
 * Proactive sidesteps that make no route progress turn into an orbit around a crowd. After a few
 * of them without reaching a new waypoint, the unit stops anticipating for a moment and lets the
 * contact rules (wait, yield, escape) resolve the encounter instead.
 */
const WINDOW_SECONDS = 4;
const SIDESTEP_LIMIT = 3;
const SUPPRESS_SECONDS = 1.5;

interface YieldBudget { count: number; pathIndex: number; suppressed: number; window: number }
const budgets = new WeakMap<SettlementActor, YieldBudget>();

/** Called once per movement update; route progress or an expired window clears the budget. */
export const tickYieldBudget = (actor: SettlementActor, dt: number) => {
  const budget = budgets.get(actor);
  if (!budget) return;
  budget.window -= dt;
  budget.suppressed -= dt;
  const expired = budget.window <= 0 && budget.suppressed <= 0;
  if (budget.pathIndex !== actor.pathIndex || expired) budgets.delete(actor);
};

export const isAnticipationSuppressed = (actor: SettlementActor) => (budgets.get(actor)?.suppressed ?? 0) > 0;

export const spendProactiveSidestep = (actor: SettlementActor) => {
  let budget = budgets.get(actor);
  if (!budget) {
    budget = { count: 0, pathIndex: actor.pathIndex, suppressed: 0, window: WINDOW_SECONDS };
    budgets.set(actor, budget);
  }
  budget.count++;
  if (budget.count < SIDESTEP_LIMIT) return;
  budget.count = 0;
  budget.suppressed = SUPPRESS_SECONDS;
  trafficWork.yieldBudgetHits++;
};

/** [actor uid, sidesteps, path index, seconds suppressed, seconds left in the window] (format 21). */
export type SavedYieldBudget = [number, number, number, number, number];

export const saveYieldBudgets = (actors: readonly SettlementActor[]): SavedYieldBudget[] =>
  actors.flatMap(actor => {
    const budget = budgets.get(actor);
    return budget ? [[actor.uid, budget.count, budget.pathIndex, budget.suppressed, budget.window]] : [];
  });

export const restoreYieldBudgets = (actors: readonly SettlementActor[], saved?: readonly SavedYieldBudget[]) => {
  if (!saved) return;
  const byUid = new Map(actors.map(actor => [actor.uid, actor]));
  for (const [uid, count, pathIndex, suppressed, window] of saved) {
    const actor = byUid.get(uid);
    if (actor) budgets.set(actor, { count, pathIndex, suppressed, window });
  }
};
