import { createExternalStore } from "../../components/ui-store";
import type { ExplorationUiSnapshot } from "../contracts";
import { isExplorationEntryVisible } from "./view-model";

export interface ExplorationEntryOptions {
  onEnter: () => void;
  snapshot?: ExplorationUiSnapshot | null;
}

interface EntryBinding {
  onEnter: () => void;
  snapshot: ExplorationUiSnapshot | null;
}

const snapshotStore = createExternalStore<ExplorationUiSnapshot | null>(null);
const presenceStore = createExternalStore(false);
let binding: EntryBinding | null = null;
let bindingId = 0;

const entrySignature = (snapshot: ExplorationUiSnapshot | null) => {
  if (!snapshot) return "";
  const seconds = Math.ceil(Math.max(0, snapshot.cooldownInMs) / 1000);
  return [snapshot.phase, snapshot.canEnter, snapshot.eligibility.eligible,
    snapshot.eligibility.reason ?? "", seconds].join("|");
};

/**
 * The narrow bridge between the exploration adapter and the player corner. It is not a game store:
 * it carries the controller's immutable UI snapshot and one entry action, and disappears on detach.
 */
export const attachExplorationEntry = (options: ExplorationEntryOptions) => {
  const entry: EntryBinding = { onEnter: options.onEnter, snapshot: options.snapshot ?? null };
  const id = ++bindingId;
  binding = entry;
  snapshotStore.set(entry.snapshot);
  presenceStore.set(isExplorationEntryVisible(entry.snapshot));
  return () => {
    if (bindingId !== id || !binding) return;
    binding = null;
    snapshotStore.set(null);
    presenceStore.set(false);
  };
};

export const updateExplorationEntry = (snapshot: ExplorationUiSnapshot) => {
  if (!binding) return;
  const previous = binding.snapshot;
  binding = { ...binding, snapshot };
  if (entrySignature(previous) === entrySignature(snapshot)) return;
  snapshotStore.set(snapshot);
  presenceStore.set(isExplorationEntryVisible(snapshot));
};

export const getExplorationEntrySnapshot = () => snapshotStore.getSnapshot();
export const subscribeExplorationEntry = snapshotStore.subscribe;
export const getExplorationEntryPresence = () => presenceStore.getSnapshot();
export const subscribeExplorationEntryPresence = presenceStore.subscribe;

/** The button only acts on an eligible, idle snapshot; disabled markup cannot call this by mistake. */
export const requestExplorationEntry = () => {
  if (!binding?.snapshot?.canEnter || !binding.snapshot.eligibility.eligible) return;
  binding.onEnter();
};
