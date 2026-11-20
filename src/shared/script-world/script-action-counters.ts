import { TOOL_WARES } from "../../render-common/wares/ware-catalog";
import type { SettlementContext } from "../settlement/settlement-types";

/**
 * Per-island action and production counters of a script-running island (TRG4, the open point of the TRG6 receipt):
 * the QU §7.7 keys (`plant`, `ship`, `recruit`, `promote:<rank>`, `survey`, `expedition`, `produce:<ware>`,
 * `tools`) counted by the simulation itself, so `counterReached` and produce/action objectives read replayed state.
 * Saved with the script run (hashed with the island); catch-up keeps counting (design §7.4), only events stop.
 */

/** Saved form: present only when something was counted, so older script saves stay byte-identical. */
export interface SavedActionCounters {
  counters?: Record<string, number>;
}

export const createActionCounters = (saved: Readonly<Record<string, number>> = {}) => {
  const counts = new Map<string, number>(Object.entries(saved));
  return {
    increment: (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1),
    get: (key: string) => counts.get(key) ?? 0,
    /** Keys ascending, so the save (and its hash) never depends on counting order. */
    save: (): SavedActionCounters => counts.size === 0 ? {}
      : { counters: Object.fromEntries([...counts].sort(([a], [b]) => (a < b ? -1 : 1))) }
  };
};

/** An island action the quests count: the home tutorial hook (unchanged call) and a script island's counter. */
export const countIslandAction = (context: SettlementContext, key: string) => {
  context.options.onTutorialEvent?.(key);
  context.script?.counters.increment(key);
};

/** One produced ware: the production hook, then the island's `produce:<ware>` (and `tools`) counters. */
export const countProducedWare = (context: SettlementContext, ware: string) => {
  context.options.onProduced?.(ware);
  const counters = context.script?.counters;
  if (!counters) return;
  counters.increment(`produce:${ware}`);
  if (TOOL_WARES.has(ware)) counters.increment("tools");
};
