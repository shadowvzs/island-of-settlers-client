import { useRef, useSyncExternalStore } from "react";

import type { ReadableStore } from "./ui-store";

interface SelectionCache<T, S> {
  revision?: unknown;
  selection: S;
  snapshot: T;
}

/** The cached selection while inactive or unchanged; a new value only when `isEqual` says it differs. */
export const readSelection = <T, S>(
  cache: SelectionCache<T, S> | null, snapshot: T, select: (snapshot: T) => S,
  isEqual: (left: S, right: S) => boolean, active: boolean, revision?: unknown
): SelectionCache<T, S> => {
  if (cache && ((cache.snapshot === snapshot && cache.revision === revision) || !active)) return cache;
  const selection = select(snapshot);
  if (cache && cache.revision === revision && isEqual(cache.selection, selection))
    return { revision, selection: cache.selection, snapshot };
  return { revision, selection, snapshot };
};

/**
 * Selects a slice of an external store. `select` must depend on the snapshot only (derive prop-based
 * values with `useMemo`). The component re-renders only when the selection changes by `isEqual`; while
 * `active` is false (e.g. a hidden window) the last selection is kept and nothing is computed.
 */
export const useStoreSelector = <T, S>(
  store: ReadableStore<T>, select: (snapshot: T) => S,
  isEqual: (left: S, right: S) => boolean = Object.is, active = true, revision?: unknown
) => {
  const cache = useRef<SelectionCache<T, S> | null>(null);
  const getSelection = () => {
    cache.current = readSelection(cache.current, store.getSnapshot(), select, isEqual, active, revision);
    return cache.current.selection;
  };
  return useSyncExternalStore(store.subscribe, getSelection, getSelection);
};
