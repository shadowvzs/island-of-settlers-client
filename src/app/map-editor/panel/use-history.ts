import { useSyncExternalStore } from "react";

import type { EditorHistory } from "../editor-history";
import type { MapLibrary, MapLibraryState } from "../map-library";

/** Whether undo and redo are available. */
export const useHistoryState = (history: EditorHistory) =>
  useSyncExternalStore(history.subscribe, history.getState, history.getState);

/** The map library's state (name, slots, busy, storage). */
export const useMapLibraryState = (library: MapLibrary): MapLibraryState =>
  useSyncExternalStore(library.subscribe, library.getState, library.getState);
