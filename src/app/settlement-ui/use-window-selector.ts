import { useExternalStore } from "../components/external-store";
import type { ReadableStore } from "../components/ui-store";
import { useStoreSelector } from "../components/use-store-selector";
import type { SettlementWindowVisibilityStore } from "./react-window";

/**
 * A window's visibility (`opened`, `visible`) and its store selection, computed only while the window is
 * visible; a hidden window keeps its last selection.
 */
export const useWindowSelector = <T, S>(
  store: ReadableStore<T>, visibility: SettlementWindowVisibilityStore, select: (snapshot: T) => S,
  isEqual: (left: S, right: S) => boolean, revision?: unknown
) => {
  const { opened, visible } = useExternalStore(visibility);
  return { opened, selection: useStoreSelector(store, select, isEqual, visible, revision), visible };
};
