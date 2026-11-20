/**
 * Saved battlefield working state (SAVE-LOAD-DRIFT 2026-11-11). Places, holds, velocities, watches
 * and march legs steer the next decisions of every field soldier; a reload that dropped
 * them re-chose places and routes, so "save at tick N + reload" drifted from the uninterrupted run.
 * Each combat module saves its own entries in insertion order (Map iteration order is part of the
 * simulation), stale entries included, exactly as the live maps hold them. Ages are saved relative
 * to a module's own tick counter, so no counter needs saving (a quiet-island skip never advances them).
 */

/** Map entries in insertion order. */
export type SavedEntries<Value> = [number, Value][];

export const saveEntries = <Value>(map: ReadonlyMap<number, Value>): SavedEntries<Value> =>
  structuredClone([...map]);

/** Refills `map` from `saved` in saved order (validated by `militaryFieldSaveError`). */
export const restoreEntries = <Value>(map: Map<number, Value>, saved: SavedEntries<Value> | undefined) => {
  map.clear();
  for (const [key, value] of saved ?? []) map.set(key, structuredClone(value));
};
