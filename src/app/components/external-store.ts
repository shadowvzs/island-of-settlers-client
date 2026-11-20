import { useSyncExternalStore } from "react";

import type { ReadableStore } from "./ui-store";

export type { ExternalStore } from "./ui-store";

/** Reads the store's snapshot; the same snapshot serves server rendering (markup tests). */
export const useExternalStore = <T>(store: ReadableStore<T>) =>
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
