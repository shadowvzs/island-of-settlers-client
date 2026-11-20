import { createExternalStore, type ExternalStore } from "../components/ui-store";
import type { SettlementUiSnapshot } from "./types";

/**
 * One immutable settlement UI snapshot per update: the 0.5 s tick, each command and the partial
 * status / selection / road mode updates (merged into a new object). React-free, so the startup
 * settlement UI publishes into it; React views read it with `useStoreSelector`.
 */
export interface SettlementUiStore extends Omit<ExternalStore<Readonly<SettlementUiSnapshot>>, "set"> {
  /** Merges a partial snapshot into a new object; returns false (and notifies nobody) when nothing changed. */
  update: (partial: Readonly<SettlementUiSnapshot>) => boolean;
}

const INITIAL_SNAPSHOT: Readonly<SettlementUiSnapshot> = { roadMode: null, selectedBuilding: null };

/** True when every key of the partial already holds the same value (by reference). */
export const isSnapshotUnchanged = (
  current: Readonly<SettlementUiSnapshot>, partial: Readonly<SettlementUiSnapshot>
) => {
  for (const key in partial) {
    const name = key as keyof SettlementUiSnapshot;
    if (!Object.is(current[name], partial[name])) return false;
  }
  return true;
};

export const createSettlementUiStore = (initial = INITIAL_SNAPSHOT): SettlementUiStore => {
  const store = createExternalStore(initial);
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    update: partial => {
      const current = store.getSnapshot();
      if (isSnapshotUnchanged(current, partial)) return false;
      store.set({ ...current, ...partial });
      return true;
    }
  };
};
