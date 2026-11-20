import { useLingui } from "@lingui/react";
import { type KeyboardEvent, useId, useMemo, useState } from "react";

import type { WorldData } from "../../../shared/world/world-data";
import { isShallowEqual } from "../../components/ui-store";
import { useStoreSelector } from "../../components/use-store-selector";
import { selectTabByKey } from "../../components/use-tabs";
import { BRUSH_SIZES, EDITOR_TABS } from "../editor-catalog";
import type { EditorState, EditorStore } from "../editor-store";
import {
  BRUSH_STRENGTHS, formatTargetHeight, getEditorTabRows, getStatusView, toEditorTabPrefix, toMaterialRows,
  type ToolButtonSpec, toToolRows
} from "./helpers";

type StoreSource = Pick<EditorStore, "getState" | "subscribe">;

/** The editor store as an external store (`useSyncExternalStore` contract). */
const toReadable = (store: StoreSource) => ({ getSnapshot: store.getState, subscribe: store.subscribe });

/** One slice of the editor state; re-renders only when it changes (by `isEqual`). */
export const useEditorState = <S>(
  store: StoreSource, select: (state: EditorState) => S, isEqual: (left: S, right: S) => boolean = Object.is
) => {
  const readable = useMemo(() => toReadable(store), [store]);
  return useStoreSelector(readable, select, isEqual);
};

const selectTool = (state: EditorState) => state.tool;
const selectTab = (state: EditorState) => state.tab;

/** A grid's buttons, marked while their tool is active. */
export const useToolRows = (store: EditorStore, specs: readonly ToolButtonSpec[]) => {
  const tool = useEditorState(store, selectTool);
  return useMemo(() => toToolRows(specs, tool), [specs, tool]);
};

/** The stone material buttons, pressed while their placement tool is armed. */
export const useMaterialRows = (store: EditorStore) => {
  const tool = useEditorState(store, selectTool);
  return useMemo(() => toMaterialRows(tool), [tool]);
};

/** The category tabs: ARIA keyboard model (arrows wrap, Home / End), focus follows the selection. */
export const useEditorTabs = (store: EditorStore, world: Pick<WorldData, "scenario">) => {
  const { i18n } = useLingui();
  const tab = useEditorState(store, selectTab);
  const prefix = toEditorTabPrefix(useId());
  const tabs = getEditorTabRows(prefix, tab, world.scenario?.nation ?? "roman", i18n);
  const select = (index: number) => store.setTab(EDITOR_TABS[index]!.id);
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) =>
    selectTabByKey(event, index, tabs, select);
  return { tabs, onTabKeyDown, onTabSelect: select };
};

const selectBrush = ({ brushSize, brushStrength }: EditorState) => ({ brushSize, brushStrength });

/** Brush size and strength as slider levels. */
export const useBrush = (store: EditorStore) => {
  const { brushSize, brushStrength } = useEditorState(store, selectBrush, isShallowEqual);
  return {
    sizeLevel: BRUSH_SIZES.indexOf(brushSize),
    strengthLevel: BRUSH_STRENGTHS.indexOf(brushStrength),
    onSizeInput: (level: number) => store.setBrushSize(BRUSH_SIZES[level]!),
    onStrengthInput: (level: number) => store.setBrushStrength(BRUSH_STRENGTHS[level]!)
  };
};

/**
 * A number field over a stored value: the typed text shows while it still matches the stored value (typing
 * "-" or "4." keeps it), the stored value shows after any other change and when the field is left.
 */
export const useDraftNumber = (value: number, format: (value: number) => string, commit: (text: string) => number) => {
  const [draft, setDraft] = useState<{ text: string; value: number } | null>(null);
  const text = draft?.value === value ? draft.text : format(value);
  return {
    text,
    onBlur: () => setDraft(null),
    onChange: (next: string) => setDraft({ text: next, value: commit(next) })
  };
};

const selectTargetHeight = (state: EditorState) => state.targetHeight;
const selectProtectCoast = (state: EditorState) => state.protectCoast;

/** The Terrain section's target height and coast protection. */
export const useTerrainOptions = (store: EditorStore) => {
  const height = useDraftNumber(useEditorState(store, selectTargetHeight), formatTargetHeight, text => {
    store.setTargetHeight(Number(text));
    return store.getState().targetHeight;
  });
  return { height, protectCoast: useEditorState(store, selectProtectCoast), onProtectCoast: store.setProtectCoast };
};

const selectLowerMode = (state: EditorState) => state.lowerMode;

export const useLowerMode = (store: EditorStore) => useEditorState(store, selectLowerMode);

const selectStatus = ({ hint, hintIsRefusal }: EditorState) => ({ hint, hintIsRefusal });

/** The hint line under the panel. */
export const useEditorStatus = (store: EditorStore) =>
  getStatusView(useEditorState(store, selectStatus, isShallowEqual));
