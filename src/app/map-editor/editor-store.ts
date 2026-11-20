import { DEFAULT_AUTHORED_ANIMAL_AGE, MAX_ANIMAL_STAMP_POPULATION } from "../../shared/world/authored-animals";
import { createExternalStore } from "../components/ui-store";
import type { EditorTabId } from "./editor-catalog";
import type { EditorText } from "./messages";

/** The editor's tools; `value` is the material, ore, tree kind or species of the choice. */
export type EditorToolKind =
  | "scenarioRoad"
  | "biome"
  | "cover"
  | "decoration"
  | "decorationPalette"
  | "marble"
  | "river"
  | "scenario"
  | "animal"
  | "eraser"
  | "ground"
  | "lake"
  | "mountain"
  | "mineRemover"
  | "ore"
  | "plantRemover"
  | "resetGround"
  /** Script workspace "pick on map" (TRG11): the next click picks an object or makes a region. */
  | "scriptPick"
  | "stone"
  | "terrain"
  | "tree";

export interface EditorTool {
  kind: EditorToolKind;
  value: number;
}

export interface EditorState {
  /** Brush radius (cells). */
  brushSize: number;
  brushStrength: number;
  targetHeight: number;
  protectCoast: boolean;
  treeAge: number;
  hardwoodForm: number;
  animalAge: number;
  animalPopulation: number;
  /** Last message for the hint line (a refused edit, a notice), empty when none. */
  hint: EditorText;
  /** A refused edit (warning tone) or a notice. */
  hintIsRefusal: boolean;
  /**
   * The Lower toggle (trackpad / touch): Mountain and Lake clicks act as with Ctrl held, and
   * Ctrl flips them back.
   */
  lowerMode: boolean;
  /** The panel's open category (hidden categories keep their values but cannot keep editing the map). */
  tab: EditorTabId;
  /** Null: no tool picked, the map reacts as usual (camera, felling, worker). */
  tool: EditorTool | null;
}

const INITIAL_STATE: EditorState = {
  brushSize: 3,
  brushStrength: 1,
  targetHeight: 2,
  protectCoast: false,
  treeAge: 120,
  hardwoodForm: -1,
  animalAge: DEFAULT_AUTHORED_ANIMAL_AGE,
  animalPopulation: 1,
  hint: "",
  hintIsRefusal: false,
  lowerMode: false,
  tab: "terrain",
  tool: null
};

export const isSameTool = (tool: EditorTool | null, kind: EditorToolKind, value: number) =>
  tool?.kind === kind && tool.value === value;

/** The stored settings a tool applies with: brush strength, age and form (trees), age and count (animals). */
export const getToolSettings = (state: EditorState, kind: EditorToolKind) => ({
  brushStrength: state.brushStrength,
  ...(kind === "tree" ? { hardwoodForm: state.hardwoodForm, treeAge: state.treeAge } : {}),
  ...(kind === "animal" ? { animalAge: state.animalAge, animalPopulation: state.animalPopulation } : {})
});

/**
 * The editor's UI state with change listeners (the panel renders it, the input reads it).
 * Picking the active tool again puts it away.
 */
export const createEditorStore = () => {
  const store = createExternalStore(INITIAL_STATE);
  const getState = store.getSnapshot;
  const update = (change: Partial<EditorState>) => store.set({ ...getState(), ...change });
  return {
    getState,
    clearTool: () => update({ hint: "", hintIsRefusal: false, tool: null }),
    setBrushStrength: (value: number) => update({ brushStrength: Math.max(.1, Math.min(2, value)) }),
    setTargetHeight: (value: number) => {
      if (Number.isFinite(value)) update({ targetHeight: Math.max(-32, Math.min(64, value)) });
    },
    setProtectCoast: (protectCoast: boolean) => update({ protectCoast }),
    setTreeAge: (treeAge: number) => {
      if (!Number.isFinite(treeAge)) return;
      const age = Math.max(0, Math.min(120, treeAge));
      update({ treeAge: age });
    },
    setHardwoodForm: (hardwoodForm: number) => {
      if (!Number.isInteger(hardwoodForm) || hardwoodForm < -1 || hardwoodForm > 8) return;
      update({ hardwoodForm });
    },
    setAnimalAge: (value: number) => {
      if (!Number.isFinite(value)) return;
      const animalAge = Math.max(0, Math.min(1, value));
      update({ animalAge });
    },
    setAnimalPopulation: (value: number) => {
      if (!Number.isFinite(value)) return;
      const animalPopulation = Math.max(1, Math.min(MAX_ANIMAL_STAMP_POPULATION, Math.round(value)));
      update({ animalPopulation });
    },
    setBrushSize: (brushSize: number) => update({ brushSize }),
    setHint: (hint: EditorText, hintIsRefusal = false) => {
      if (hint !== getState().hint || hintIsRefusal !== getState().hintIsRefusal) {
        update({ hint, hintIsRefusal });
      }
    },
    /** Opens a category; a change puts the previous category's tool away. */
    setTab: (tab: EditorTabId) => {
      if (tab !== getState().tab) update({ hint: "", hintIsRefusal: false, tab, tool: null });
    },
    /** Calls the listener after every change; returns its unsubscribe. */
    subscribe: store.subscribe,
    toggleLowerMode: () => update({ lowerMode: !getState().lowerMode }),
    toggleTool: (kind: EditorToolKind, value = 0) =>
      update({ hint: "", tool: isSameTool(getState().tool, kind, value) ? null : { kind, value } }),
    /** Picks a tool without putting it away when it is already active. */
    selectTool: (kind: EditorToolKind, value = 0) => {
      if (!isSameTool(getState().tool, kind, value)) update({ hint: "", tool: { kind, value } });
    }
  };
};

export type EditorStore = ReturnType<typeof createEditorStore>;
