import { findHomeBuilding } from "./settlement-home";
import { addIdleSettlers } from "./settlement-population";
import type { SettlementContext } from "./settlement-types";

/**
 * What a skipped stretch of steady offline time did to the island's own counters. Everything else
 * (actors, timers, resting stones, crops) keeps its phase: the skipped stretch repeats measured ones.
 */
export interface SettlementFastForward {
  /** Settlers born meanwhile; they join the home building's idle people. */
  births: number;
  /** Units worked from each finite source (a fishing site); never exhausts one. */
  resources: Readonly<Record<string, number>>;
  /** Eligible resting seconds the skipped stretch gives the island's soldiers. */
  recoverySeconds?: number;
}

/** Applies a skip planned from measured steady rates; goods are moved by the caller's ledger. */
export const fastForwardSettlement = (context: SettlementContext, skip: SettlementFastForward) => {
  const home = findHomeBuilding(context);
  if (home && skip.births > 0) {
    addIdleSettlers(context, home, skip.births);
    context.population!.births += skip.births;
  }
  for (const [key, used] of Object.entries(skip.resources)) {
    const left = context.resourceAmounts.get(key);
    if (left !== undefined) context.resourceAmounts.set(key, Math.max(1, left - used));
  }
};
