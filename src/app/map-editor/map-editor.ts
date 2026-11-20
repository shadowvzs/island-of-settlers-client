import type { I18n } from "@lingui/core";
import { contentCatalogVersion } from "@shared/catalog";

import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { validateMapScenario } from "../../shared/settlement/settlement-map-scenario";
import type { ResourceTarget } from "../../shared/settlement/settlement-types";
import { createEditGround, type EditGround, refreshRoughCells } from "../../shared/world/editing/build-refresh";
import type { EditRefusal } from "../../shared/world/editing/edit-refusal";
import type { FeatureTransformRuntime } from "../../shared/world/editing/terrain/generated-feature-runtime";
import type { TerrainEditState } from "../../shared/world/editing/terrain/terrain-edit-state";
import type { CellRegion } from "../../shared/world/grid-geometry";
import { deriveSeed } from "../../shared/world/rng";
import type { PlacedAnimal } from "../../shared/world/save/map-format";
import type { WorldData } from "../../shared/world/world-data";
import { runWhenIdle } from "../components/lazy-react-content";
import type { IslandChoice } from "../map-generator/helpers";
import { createBrushPreview, SELECTION_RING_COLOR } from "./brush-preview";
import { getCatalogVersionWarning } from "./catalog-version/helpers";
import type { EditContext } from "./editor-apply";
import { createEditorBootstrap } from "./editor-bootstrap";
import { type EditorTabId, REFUSAL_HINTS } from "./editor-catalog";
import { createEditorHistory } from "./editor-history";
import { createEditorInput } from "./editor-input";
import { createEditorPanel } from "./editor-panel";
import { createEditRefresher } from "./editor-refresh";
import { type EditorTool, type EditorToolKind } from "./editor-store";
import { createHistoryRebuild } from "./history-rebuild";
import { bindHistoryShortcuts } from "./history-shortcuts";
import { createEditorFrameLoop, type EditorPointer } from "./map-editor-frame";
import { createEditorOverlays } from "./map-editor-overlays";
import { createEditorStampHandler } from "./map-editor-stamp";
import { recordPlacedAnimals } from "./map-library";
import { editorMessage, MAP_EDITOR_MESSAGES as M } from "./messages";
import type { RegenerateSeedWorld } from "./seed-generation-worker";
import { createTerrainStroke } from "./terrain-stroke";
import { createTerrainTool, type TerrainToolOptions } from "./terrain-tool";
/** Ring radius of the single placement tools (a tree, an animal), world units. */
const PLACE_RING = 0.6;
/** Drag spacing of the brush (share of its radius) and of the placement tools (cells). */
const BRUSH_SPACING = 0.35;
const PLACE_SPACING = 2.5;

/** What the editor's saves add besides the world: placed animals, stamps and the content catalog version. */
const toAuthoredSaveInput = (animals: readonly PlacedAnimal[], terrain: TerrainEditState | null) =>
  ({ animals, contentCatalogVersion: contentCatalogVersion(), terrain });

/** The running map for save / load: a loaded map's name and animals, or a generated island's. */
export interface EditorMap {
  /** Animals placed with the editor (a loaded map's; placed again at the start). */
  animals: readonly PlacedAnimal[];
  /** The content catalog version a loaded map was authored with (absent: generated island or older file). */
  contentCatalogVersion?: string;
  /** Why a `?map=` start fell back to a generated island (shown once), empty when none. */
  loadError: string;
  name: string;
  /** Exact published catalog revision the world came from, when it has one. */
  provenance?: import("../../shared/world/save/map-provenance").MapProvenance;
  /** How the island was first generated (kept in the file). */
  source: string;
  /** A loaded map's mountain and lake stamps (lowered and reset as before the save). */
  terrain: TerrainEditState | null;
}

export interface MapEditorOptions {
  /** Active Lingui instance for DOM/canvas copy drawn outside React. */
  i18n?: I18n;
  getHuntingTargets?: () => readonly ResourceTarget[];
  regenerateSeedWorld?: RegenerateSeedWorld;
  /** The animals' (and workers') navigation after terrain edits. */
  animals: TerrainToolOptions["animals"];
  /** Worker builds of terrain edits (the edited area, the animals' navigation). */
  builders: TerrainToolOptions["builders"];
  map: EditorMap;
  /** Trees were placed (felling and growth adopt them). */
  onTreesPlaced: (ids: readonly number[]) => void;
  /** World props were removed (felling forgets the trees among them). */
  onPropsRemoved: (ids: readonly number[]) => void;
  /** Undo / redo brought world props back (felling and growth adopt the trees among them). */
  onPropsRestored: (ids: readonly number[]) => void;
  onPropsMoved?: (ids: readonly number[]) => void;
  /** In-page map load; absent keeps the durable `?map=` reload. */
  loadMap?: (slotId: string) => boolean | Promise<boolean>;
  /** In-page replacement generation; absent keeps the durable generator reload. */
  onGenerateMap?: (choice: IslandChoice, seed?: number) => void;
  generatedFeatureRuntime?: () => FeatureTransformRuntime;
  /** Places wildlife at its authored initial age; false when habitat or body space is unsuitable. */
  placeAnimal: (species: number, x: number, z: number, age?: number) => boolean;
  restoreAnimal?: (species: number, x: number, z: number, age?: number) => boolean;
  validateAnimals?: (animals: readonly PlacedAnimal[]) => readonly string[];
  /** The animal homes follow the edited cells (after the edit is rebuilt). */
  refreshHomes: (cells: CellRegion) => void;
  refreshMinimap: () => void;
  /** Animals and workers inside a new mountain or lake move out. */
  relocate: TerrainToolOptions["relocate"];
  /** Takes a placed animal away again (undo); false when it is gone already. */
  removeAnimal: (species: number, x: number, z: number) => boolean;
  renderer: TerrainRenderer;
  viewport: HTMLElement;
  visible: boolean;
  onEdit?: () => void;
  /** Refuses live edits while shared stock or committed transport could change pool membership. */
  canEditStorageTerrain?: () => boolean;
  /** Rebinds empty idle storage membership after an actual terrain mutation. */
  rebaseStorageTerrain?: () => void;
  world: WorldData;
}

/** Tools that work on the brush's circle (the others act at a point). */
const BRUSH_TOOLS: ReadonlySet<EditorToolKind> = new Set<EditorToolKind>([
  "biome",
  "cover",
  "eraser",
  "ground",
  "ore",
  "mineRemover",
  "plantRemover",
  "resetGround",
  "terrain"
]);

const isBrushTool = (tool: EditorTool | null) => tool !== null && BRUSH_TOOLS.has(tool.kind);

const getRingRadius = (tool: EditorTool | null, brushSize: number) =>
  isBrushTool(tool) ? brushSize : PLACE_RING;

/** The edit context: the fixed ground for the build layers is measured on the first edit. */
const createContext = (world: WorldData, placeAnimal: MapEditorOptions["placeAnimal"]) => {
  let ground: EditGround | null = null;
  let seeds = 0;
  const firstPlacedProp = world.props.count;
  const nextSeed = () => deriveSeed(world.seed, `editor-${(seeds += 1)}`);
  return {
    firstPlacedProp,
    ensureGround: () => (ground ??= createEditGround(world)),
    get: (): EditContext => {
      ground ??= createEditGround(world);
      return { firstPlacedProp, ground, nextSeed, placeAnimal, world };
    },
    nextSeed,
    /** Undo / redo restored tiles: the rough ground follows them. */
    refreshGround: (cells: CellRegion) => {
      if (ground) refreshRoughCells(world, ground, cells);
    },
    /** The heights changed: the fixed ground was measured again. */
    setGround: (next: EditGround) => {
      ground = next;
    }
  };
};

/**
 * The map editor (Settings > Experimental > Map editor): the panel picks a tool, a left drag on
 * the map applies it at the cursor through the shared edit operations, and the renderer rebuilds
 * only what changed (batched while dragging). A ring previews the brush on the ground.
 */
export const createMapEditor = (options: MapEditorOptions) => {
  const { renderer, viewport, world } = options;
  const placedAnimals = recordPlacedAnimals(options.map.animals, options);
  const { canEdit, library, onEdit, store } = createEditorBootstrap(options, placedAnimals.list, () => terrain);
  const preview = createBrushPreview({ renderer, viewport, world });
  /** The selected decoration's ground ring (a 2D overlay, so it costs no extra pass on Minimal). */
  const decorationHighlight = createBrushPreview({ color: SELECTION_RING_COLOR, lineWidth: 3, renderer, viewport,
    world });
  const context = createContext(world, placedAnimals.place);
  const refresher = createEditRefresher({
    firstPlacedProp: context.firstPlacedProp,
    mapEdit: renderer.mapEdit,
    refreshHomes: options.refreshHomes,
    refreshMinimap: options.refreshMinimap,
    refreshNavigation: cells => terrain.refreshNavigation(cells),
    world
  });
  const terrain = createTerrainTool({
    animals: options.animals,
    builders: options.builders,
    canEdit,
    getGround: context.ensureGround,
    mapEdit: renderer.mapEdit,
    onRebuildError: () => store.setHint(M.hints.rebuildFailed, true),
    onApplied: (batch) => {
      history.note({ cells: batch.cells });
      context.setGround(batch.ground);
      refresher.afterTerrain(batch);
      stampHandler.replayResets();
      if (batch.removed.length > 0) options.onPropsRemoved(batch.removed);
      history.settle();
    },
    onBeforeApply: (cells) => history.capture({ cells }),
    onDiscarded: () => stampHandler.discardPendingResets(),
    onTerrainEdited: options.rebaseStorageTerrain,
    refreshHomes: options.refreshHomes,
    relocate: options.relocate,
    state: options.map.terrain,
    world
  });
  const history = createEditorHistory({
    beforeRestore: options.onEdit,
    canRestore: canEdit,
    afterRestore: options.rebaseStorageTerrain,
    animals: placedAnimals,
    flush: terrain.flush,
    isQueued: terrain.isQueued,
    rebuild: createHistoryRebuild({
      ...options,
      refreshGround: context.refreshGround,
      refresher,
      terrain
    }),
    terrain: terrain.state,
    world
  });
  let enabled = options.visible;
  /** A section is on screen: the editor is open on its category. */
  const isTabShown = (tab: EditorTabId) => enabled && store.getState().tab === tab;
  const overlays = createEditorOverlays({
    editContext: context,
    editor: options,
    history,
    isTabShown,
    library,
    onEdit,
    refresher,
    renderer,
    store,
    terrain,
    viewport,
    world
  });
  const {
    coastReshape, decorationEditor, decorationPalette, environmentDefaults, fishingWater,
    generatedFeatures, generatedTransforms, groundPalette, harbourSpotOverlay, marbleEditor, navigationOverlay,
    oreEditor, originalFeatures, patrolEditor, riverEditor, scenarioEditor, scenarioOverlay,
    scenarioRoads, scenarioSpace, scopedRestore, scriptWindow, terrainFeatures, vegetationRegrowth
  } = overlays;
  let panel: ReturnType<typeof createEditorPanel> | undefined;
  let stopHistoryShortcuts: (() => void) | undefined;
  let disposed = false;
  const visibilityListeners = new Set<(visible: boolean) => void>();
  const setEnabled = (value: boolean) => {
    if (disposed) return;
    enabled = value;
    if (value) {
      panel ??= makePanel();
      runWhenIdle(() => {
        if (disposed) return;
        riverEditor.prepare();
        // Warm the fixed build ground before the first click: the first edit no longer pays
        // the whole-island measurement on the interactive path.
        context.ensureGround();
      }, 1000);
    }
    if (value && world.scenario) {
      const problems = validateMapScenario(world);
      if (problems.length) {
        store.setHint(editorMessage(M.hints.mapDraftProblems, { problems: problems.join("; ") }), true);
      }
    }
    panel?.setVisible(value);
    for (const listener of visibilityListeners) listener(value);
  };
  const makePanel = () => {
    stopHistoryShortcuts = bindHistoryShortcuts(history, () => enabled);
    return createEditorPanel(viewport, {
      catalogWarning: getCatalogVersionWarning(options.map.contentCatalogVersion, contentCatalogVersion()),
      close: () => setEnabled(false),
      coast: coastReshape, decorationPalette, decorations: decorationEditor, environment: environmentDefaults,
      fishing: fishingWater,
      generatedFeatures, generatedTransforms, groundPalette, history, library, marble: marbleEditor,
      navigation: navigationOverlay, ore: oreEditor, originalFeatures, patrol: patrolEditor,
      replacement: options.onGenerateMap, river: riverEditor,
      roads: scenarioRoads, scenario: scenarioEditor, scenarioSpace, scopedRestore, script: scriptWindow, store,
      terrainFeatures, vegetation: vegetationRegrowth, world
    }, options.i18n);
  };
  const pointer: EditorPointer = { ctrl: false, hover: null };
  let refused = false;

  const showRefusal = (refusal: EditRefusal | null) => {
    if (!canEdit()) return;
    refused = refusal !== null;
    store.setHint(refusal ? REFUSAL_HINTS[refusal] : "", refusal !== null);
  };
  const terrainStroke = createTerrainStroke({
    nextSeed: context.nextSeed,
    renderer,
    showRefusal,
    store,
    terrain,
    world
  });
  const stampHandler = createEditorStampHandler({
    applyContext: context.get,
    decorationEditor,
    decorationPalette,
    history,
    marbleEditor,
    onEdit,
    onPropsRemoved: options.onPropsRemoved,
    onTreesPlaced: options.onTreesPlaced,
    refresher,
    riverEditor,
    scenarioEditor,
    scenarioRoads,
    scriptWindow,
    showRefusal,
    store,
    terrain,
    terrainStroke,
    world
  });

  const isActive = () => enabled && store.getState().tool !== null;

  const input = createEditorInput({
    canvas: viewport.querySelector("canvas") ?? viewport,
    isActive, onCancel: store.clearTool,
    onHover: (point, ctrl) => {
      pointer.hover = point;
      pointer.ctrl = ctrl;
    },
    onStamp: stampHandler.stamp,
    onStrokeEnd: () => {
      riverEditor.finish();
      terrainStroke.finish(pointer.hover);
      refresher.finishStroke();
      history.endStroke();
    },
    pick: terrainStroke.pick,
    spacing: () => {
      const { brushSize, tool } = store.getState();
      return isBrushTool(tool) ? Math.max(0.5, brushSize * BRUSH_SPACING) : PLACE_SPACING;
    }
  });

  const frameLoop = createEditorFrameLoop({
    decorationEditor,
    decorationHighlight,
    getEnabled: () => enabled,
    getRefused: () => refused,
    getRingRadius,
    input,
    isActive,
    isDisposed: () => disposed,
    overlays,
    pointer,
    preview,
    refresher,
    store,
    terrainStroke
  });
  frameLoop.start();
  if (enabled) {
    panel = makePanel();
    panel.setVisible(true);
    runWhenIdle(() => { if (!disposed) context.ensureGround(); }, 1000);
  }

  return {
    /** Stops editor frames, input, overlays, timers, storage and the panel (island teardown). */
    dispose: () => {
      if (disposed) return;
      disposed = true;
      frameLoop.stop();
      stopHistoryShortcuts?.();
      input.dispose();
      harbourSpotOverlay.dispose();
      panel?.dispose();
      scriptWindow.dispose();
      terrain.dispose();
      coastReshape.cancelPreview();
      library.dispose();
      scenarioOverlay.dispose();
      preview.dispose();
      decorationHighlight.dispose();
      for (const canvas of viewport.querySelectorAll(".map-editor-overlay")) canvas.remove();
      visibilityListeners.clear();
    },
    /** Authored decoration models and the palette's placement ghost (editor render preview). */
    decorationFrames: decorationPalette.frames,
    decorationGhost: () => decorationPalette.getGhost(isActive() ? pointer.hover : null),
    scenarioDefinition: () => structuredClone(world.scenario),
    authoredRivers: () => structuredClone(world.authoredRivers ?? []),
    generatedRivers: () => structuredClone(world.generatedRivers ?? []),
    generatedFeatureIdentities: () => structuredClone(world.generatedFeatureIdentities ?? []),
    validateScenario: () => [...validateMapScenario(world), ...(options.validateAnimals?.(placedAnimals.list()) ?? [])],
    placeAnimal: placedAnimals.place,
    saveInput: () => { terrain.flush(); return toAuthoredSaveInput(placedAnimals.list(), terrain.state); },
    /** Undo steps kept and their memory (performance notes). */
    historyStats: history.stats,
    /** A tool is active: presses on the map edit (Shift + drag pans instead of box selecting). */
    isToolActive: isActive,
    isEnabled: () => enabled,
    /** The Development toggle follows panel-opened/closed changes too. */
    onEnabledChange: (listener: (visible: boolean) => void) => {
      visibilityListeners.add(listener);
      return () => { visibilityListeners.delete(listener); };
    },
    setEnabled,
    /** Rebuild timings (Playwright, performance notes). */
    stats: refresher.stats,
    terrainStats: terrain.stats
  };
};
