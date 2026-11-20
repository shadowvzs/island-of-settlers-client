import { useLingui } from "@lingui/react";
import { useMemo, useSyncExternalStore } from "react";

import {
  getExplorationEntryPresence,
  getExplorationEntrySnapshot,
  subscribeExplorationEntry,
  subscribeExplorationEntryPresence
} from "./entry-store";
import { selectExplorationEntryView } from "./view-model";

/** Adds the extra player-corner row only while the exploration entry is actually available. */
export const useExplorationEntryPresence = () =>
  useSyncExternalStore(
    subscribeExplorationEntryPresence,
    getExplorationEntryPresence,
    getExplorationEntryPresence
  );

export const useExplorationEntryView = () => {
  const { i18n } = useLingui();
  const snapshot = useSyncExternalStore(
    subscribeExplorationEntry,
    getExplorationEntrySnapshot,
    getExplorationEntrySnapshot
  );
  return useMemo(() => selectExplorationEntryView(snapshot, i18n), [i18n, snapshot]);
};
