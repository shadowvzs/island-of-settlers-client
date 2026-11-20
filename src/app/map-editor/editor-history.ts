import type { DiffSide } from "../../shared/world/editing/history/history-meta";
import { createUndoStack } from "../../shared/world/editing/history/undo-stack";
import {
  applyWorldDiff,
  createWorldSnapshot,
  type PropChanges,
  type WorldDiff,
  type WorldEditScope
} from "../../shared/world/editing/history/world-diff";
import type { TerrainEditState } from "../../shared/world/editing/terrain/terrain-edit-state";
import { type CellRegion,EMPTY_REGION, unionRegions } from "../../shared/world/grid-geometry";
import type { PlacedAnimal } from "../../shared/world/save/map-format";
import { markWorldChangedAll } from "../../shared/world/save/world-change-journal";
import type { WorldData } from "../../shared/world/world-data";
import { addListener } from "./helpers";

/** Undo steps kept, and their memory budget (whichever is reached first). */
export const HISTORY_LIMITS = { maxBytes: 64 * 1024 * 1024, maxSteps: 50 };

/** What an edit's rebuild covered (the undo and redo rebuild the same). */
export interface StepArea {
  cells: CellRegion;
  /** The ground material changed: the field cover regrows. */
  ground: boolean;
  mineStones: boolean;
  stoneCells: CellRegion;
}

/** One undo step: one click or one brush stroke (pointer down to up). */
export interface HistoryStep {
  /** Animals the step placed. */
  animals: PlacedAnimal[];
  area: StepArea;
  bytes: number;
  /** The world change, null when the step only placed animals. */
  diff: WorldDiff | null;
}

export interface HistoryState {
  canRedo: boolean;
  canUndo: boolean;
}

/** A step's first call may keep the terrain stamps before a queued click changes them. */
export interface HistoryBeginOptions {
  /** Captures the small state now, the world layers later (before they are applied). */
  deferLayers?: boolean;
}

export interface EditorHistoryOptions {
  beforeRestore?: () => void;
  canRestore?: () => boolean;
  afterRestore?: () => void;
  /** The animals the editor placed (a step keeps the ones it added). */
  animals: {
    list: () => readonly PlacedAnimal[];
    place: (species: number, x: number, z: number, age?: number) => boolean;
    remove: (animal: PlacedAnimal) => void;
    restore?: (animal: PlacedAnimal) => void;
  };
  /** Applies waiting terrain clicks at once (before an undo or redo). */
  flush: () => void;
  /** Terrain clicks wait to be applied (the step is not complete yet). */
  isQueued: () => boolean;
  /** Rebuilds what a restored step changed (the same paths an edit uses). */
  rebuild: (step: HistoryStep, side: DiffSide, props: PropChanges) => void;
  terrain: TerrainEditState | null;
  world: WorldData;
}

const createArea = (): StepArea => ({
  cells: EMPTY_REGION,
  ground: false,
  mineStones: false,
  stoneCells: EMPTY_REGION
});

const mergeArea = (area: StepArea, change: Partial<StepArea>): StepArea => ({
  cells: unionRegions(area.cells, change.cells ?? EMPTY_REGION),
  ground: area.ground || (change.ground ?? false),
  mineStones: area.mineStones || (change.mineStones ?? false),
  stoneCells: unionRegions(area.stoneCells, change.stoneCells ?? EMPTY_REGION)
});

const NO_PROP_CHANGES: PropChanges = { removed: [], restored: [] };
/** Memory of a placed animal entry. */
const ANIMAL_BYTES = 32;

/**
 * Undo / redo of the map editor. A step begins with a stroke's first stamp (the world is copied
 * once, reused buffers) and ends when the stroke ended and its terrain clicks were applied; then
 * only what changed is kept (spans of every layer, props, mine zones, terrain stamps, placed
 * animals). Undo writes the old values back, redo the new ones, and the edit's own rebuild runs
 * for the area. Workers moved out of a footprint stay where they are (runtime state).
 */
export const createEditorHistory = (options: EditorHistoryOptions) => {
  const { terrain, world } = options;
  const snapshot = createWorldSnapshot(world, terrain);
  const stack = createUndoStack<HistoryStep>(HISTORY_LIMITS);
  const listeners: ((state: HistoryState) => void)[] = [];
  /** The step being made: its area and how many placed animals there were at its start. */
  let open: { animalCount: number; area: StepArea } | null = null;
  let stroke = false;

  /** Undo / redo availability; the same object until it changes (a `useSyncExternalStore` snapshot). */
  let state: HistoryState = { canRedo: false, canUndo: false };
  const getState = () => {
    const canRedo = stack.canRedo(), canUndo = stack.canUndo();
    if (canRedo !== state.canRedo || canUndo !== state.canUndo) state = { canRedo, canUndo };
    return state;
  };
  /** Every history change (also one that keeps undo / redo availability) reaches the listeners. */
  const notify = () => {
    const current = getState();
    for (const listener of listeners) listener(current);
  };

  /** Keeps the open step when it changed anything. */
  const commit = () => {
    if (!open) return;
    const diff = snapshot.diff();
    const { animalCount, area } = open;
    const animals = options.animals.list().slice(animalCount);
    open = null;
    if (!diff && animals.length === 0) return;
    const bytes = (diff?.bytes ?? 0) + animals.length * ANIMAL_BYTES;
    stack.push({ animals, area, bytes, diff });
    notify();
  };

  /** Commits once the stroke is over and no terrain click waits. */
  const settle = () => {
    if (!stroke && !options.isQueued()) commit();
  };

  const restore = (step: HistoryStep, side: DiffSide) => {
    options.beforeRestore?.();
    markWorldChangedAll(world);
    const props = step.diff ? applyWorldDiff(world, terrain, step.diff, side) : NO_PROP_CHANGES;
    options.afterRestore?.();
    for (const animal of step.animals) {
      if (side === "before") options.animals.remove(animal);
      else if (options.animals.restore) options.animals.restore(animal);
      else options.animals.place(animal.species, animal.x, animal.z, animal.age);
    }
    options.rebuild(step, side, props);
    notify();
  };

  /** Undo / redo run between strokes, after waiting clicks were applied and kept. */
  const prepare = () => {
    if (stroke) return false;
    if (options.canRestore?.() === false) return false;
    options.flush();
    commit();
    return true;
  };

  /** A stroke's stamp: the first one opens a step (captures the world as it is). */
  const openStep = () => {
    // Any map editor edit is an unexplained world change for the save journal (full copy next).
    markWorldChangedAll(world);
    if (open) return;
    snapshot.reset();
    snapshot.captureMeta();
    open = { animalCount: options.animals.list().length, area: createArea() };
  };
  /**
   * Opens a step (or adds the edit's bounds to the open one). `deferLayers` keeps the small state
   * now (terrain stamps before a queued click mutates them) and lets the tool capture the world
   * layers just before it applies them.
   */
  const begin = (scope?: WorldEditScope, beginOptions?: HistoryBeginOptions) => {
    stroke = true;
    openStep();
    if (!beginOptions?.deferLayers) snapshot.captureLayers(scope);
  };
  /** Captures the world layers of a deferred step before the edit mutates them. */
  const capture = (scope?: WorldEditScope) => {
    openStep();
    snapshot.captureLayers(scope);
  };
  const endStroke = () => {
    stroke = false;
    settle();
  };

  return {
    begin,
    capture,
    /** The stroke ended (the step commits once its terrain clicks were applied). */
    endStroke,
    getState,
    /** What the open step's rebuild covered. */
    note: (change: Partial<StepArea>) => {
      if (open) open.area = mergeArea(open.area, change);
    },
    redo: () => {
      if (!prepare()) return;
      const step = stack.redo();
      if (step) restore(step, "after");
    },
    settle,
    /** Kept steps and their memory (performance notes). */
    stats: () => ({ bytes: stack.countBytes(), steps: stack.countSteps() }),
    /** Calls the listener after every change; returns its unsubscribe. */
    subscribe: (listener: (state: HistoryState) => void) => addListener(listeners, listener),
    /** One undo step around a non-stroke edit (a scenario or identity commit); the stroke ends even on a throw. */
    transaction: (action: () => void) => {
      begin();
      try {
        action();
      } finally {
        endStroke();
      }
    },
    undo: () => {
      if (!prepare()) return;
      const step = stack.undo();
      if (step) restore(step, "before");
    }
  };
};

export type EditorHistory = ReturnType<typeof createEditorHistory>;
