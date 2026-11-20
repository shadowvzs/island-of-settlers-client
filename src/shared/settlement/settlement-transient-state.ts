import type { SettlementContext } from "./settlement-types";

/**
 * Unsaved per-island state (queues, cursors, budgets, failed-search memos) lives in maps keyed by the context's
 * transient key. `resetTransientState` (every `loadState`) replaces the key, so all of them restart empty
 * together: a reloaded island then plays exactly like one resumed from the same save (snapshot fidelity, D3).
 */
const transientKey = (context: SettlementContext) => context.transient ??= {};

/** Forgets every value of every transient map for this island (a load replaces the whole state). */
export const resetTransientState = (context: SettlementContext) => {
  context.transient = {};
};

/** A context-keyed map that a load empties; use it for unsaved state that changes the simulation. */
export const createTransientMap = <Value>() => {
  const values = new WeakMap<object, Value>();
  return {
    delete: (context: SettlementContext) => values.delete(transientKey(context)),
    get: (context: SettlementContext) => values.get(transientKey(context)),
    set: (context: SettlementContext, value: Value) => { values.set(transientKey(context), value); }
  };
};
