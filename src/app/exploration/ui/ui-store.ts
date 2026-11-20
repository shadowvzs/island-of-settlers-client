import type { ReadableStore } from "../../components/ui-store";
import { createExternalStore } from "../../components/ui-store";
import { createIdleExplorationSnapshot, type ExplorationUiSnapshot } from "../contracts";

export interface ExplorationUiStore extends ReadableStore<ExplorationUiSnapshot> {
  dispose: () => void;
  publish: (snapshot: ExplorationUiSnapshot) => ExplorationUiSnapshot;
}

/** Small immutable snapshots: the controller may reuse its object, React always sees a frozen copy. */
const freezeExplorationSnapshot = (snapshot: ExplorationUiSnapshot): ExplorationUiSnapshot =>
  Object.freeze({
    ...snapshot,
    eligibility: Object.freeze({ ...snapshot.eligibility })
  }) as ExplorationUiSnapshot;

export const createExplorationUiStore = (
  initial: ExplorationUiSnapshot = createIdleExplorationSnapshot()
): ExplorationUiStore => {
  const store = createExternalStore(freezeExplorationSnapshot(initial));
  let disposed = false;
  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      store.set(freezeExplorationSnapshot(createIdleExplorationSnapshot()));
    },
    getSnapshot: store.getSnapshot,
    publish: (snapshot) => {
      if (disposed) return store.getSnapshot();
      const frozen = freezeExplorationSnapshot(snapshot);
      store.set(frozen);
      return frozen;
    },
    subscribe: store.subscribe
  };
};
