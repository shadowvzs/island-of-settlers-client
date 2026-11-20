import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { GROUND_VARIANT_COUNT } from "../../shared/world/ground-variants";
import type { WorldData } from "../../shared/world/world-data";
import { createCoastReshapeEditor } from "./coast-reshape-editor";
import { createDecorationEditor } from "./decoration-editor";
import { createDecorationPaletteEditor } from "./decoration-palette-editor";
import type { EditorTabId } from "./editor-catalog";
import type { EditorHistory } from "./editor-history";
import type { EditRefresher } from "./editor-refresh";
import type { EditorStore } from "./editor-store";
import { createEnvironmentDefaultsEditor } from "./environment-defaults-editor";
import { createFishingWaterEditor } from "./fishing-water-editor";
import { createGeneratedFeatureInspector } from "./generated-feature-inspector";
import { createGeneratedFeatureTransformControls } from "./generated-feature-transform-controls";
import { createGroundPaletteEditor } from "./ground-palette-editor";
import { createHarbourSpotOverlay } from "./harbour-spot-overlay";
import type { MapEditorOptions } from "./map-editor";
import type { MapLibrary } from "./map-library";
import { createMarbleEditor } from "./marble-editor";
import { createNavigationOverlay } from "./navigation-overlay";
import { createOreEditor } from "./ore-editor";
import { createOriginalFeatureSelector } from "./original-feature-selector";
import { createPatrolEditor } from "./patrol-editor";
import { createRiverEditor } from "./river-editor";
import { createCatapultMarkerSelection } from "./scenario-catapult-helpers";
import { createScenarioEditor } from "./scenario-editor";
import { createScenarioOverlay } from "./scenario-overlay";
import { createScenarioRoadEditor } from "./scenario-road-editor";
import { createScenarioSpaceEditor } from "./scenario-space-editor";
import { createScopedTerrainRestoreEditor } from "./scoped-terrain-restore-editor";
import { createScriptWindow, openScriptDeepLink } from "./script/script-window";
import { createTerrainFeatureEditor } from "./terrain-feature-editor";
import type { TerrainTool } from "./terrain-tool";
import { createVegetationRegrowthEditor } from "./vegetation-regrowth-editor";

export interface EditorOverlaysOptions {
  /** The editor's fixed ground, seeds and placement (only `nextSeed` is needed here). */
  editContext: { nextSeed: () => number };
  /** The main editor options (i18n, prop callbacks, regeneration, hunting targets). */
  editor: MapEditorOptions;
  history: EditorHistory;
  /** A section is on screen: the editor is open on its category. */
  isTabShown: (tab: EditorTabId) => boolean;
  library: MapLibrary;
  onEdit: () => boolean;
  refresher: EditRefresher;
  renderer: TerrainRenderer;
  store: EditorStore;
  terrain: TerrainTool;
  viewport: HTMLElement;
  world: WorldData;
}

/**
 * The editor's section controllers and map overlays: one small controller per panel section
 * (each owns its overlay and edit logic). The panel renders them, the frame draws them.
 */
export const createEditorOverlays = (options: EditorOverlaysOptions) => {
  const { editContext, history, isTabShown, library, onEdit, refresher, renderer, store, terrain,
    viewport, world } = options;
  const { generatedFeatureRuntime, getHuntingTargets, i18n, onPropsMoved, onPropsRemoved, onTreesPlaced,
    regenerateSeedWorld, relocate } = options.editor;
  const patrolEditor = createPatrolEditor(world, viewport, renderer, history, store, onEdit, i18n);
  const oreEditor = createOreEditor(world, store, history, refresher, onEdit);
  const environmentDefaults = createEnvironmentDefaultsEditor(world, history, store, onEdit);
  const groundPalette = createGroundPaletteEditor(world, history, store, onEdit);
  // The variant paint layer exists from the editor's start, so the undo history captures its first strokes.
  world.groundVariants ??= new Uint8Array(world.heights.length * GROUND_VARIANT_COUNT);
  const decorationEditor = createDecorationEditor(world, store, history, refresher,
    editContext.nextSeed, onEdit);
  const decorationPalette = createDecorationPaletteEditor(world, store, history, decorationEditor, onEdit);
  const terrainFeatures = createTerrainFeatureEditor(world, terrain, history, store, onEdit);
  const scenarioSpace = createScenarioSpaceEditor(world, viewport, renderer, () => isTabShown("map"),
    getHuntingTargets, i18n);
  const navigationOverlay = createNavigationOverlay(world, viewport, renderer);
  const harbourSpotOverlay = createHarbourSpotOverlay(world, viewport, renderer, i18n);
  const generatedFeatures = createGeneratedFeatureInspector(world, viewport, renderer);
  const originalFeatures = createOriginalFeatureSelector(world, viewport, renderer, history, store,
    onEdit, () => terrain.stats.busy, regenerateSeedWorld);
  const coastReshape = createCoastReshapeEditor(world, viewport, renderer, terrain, history, store,
    onEdit, (preview, moved) => {
      if (preview.removed.length) onPropsRemoved(preview.removed);
      if (moved.length) onPropsMoved?.(moved);
      relocate((x, z) => x >= preview.cells.minX && x <= preview.cells.maxX + 1 &&
        z >= preview.cells.minZ && z <= preview.cells.maxZ + 1 &&
        !world.walkCost[Math.floor(z) * world.cellsX + Math.floor(x)]);
      refresher.afterTerrain({ cells: preview.cells, propsChanged: preview.removed.length + moved.length > 0,
        removed: preview.removed });
    });
  const generatedTransforms = createGeneratedFeatureTransformControls(world, terrain, history, store,
    generatedFeatures.selection, onEdit, refresher, onPropsMoved, generatedFeatureRuntime);
  const scopedRestore = createScopedTerrainRestoreEditor(world, terrain, history, store,
    generatedFeatures.selection, onEdit, relocate, regenerateSeedWorld);
  const fishingWater = createFishingWaterEditor(world, viewport, renderer, store);
  const vegetationRegrowth = createVegetationRegrowthEditor(world, viewport, renderer, store, history, refresher, {
    adoptPlaced: ids => {
      onTreesPlaced([...ids]);
      const cells = new Set(ids.map(id => Math.floor(world.props.z[id]!) * world.cellsX +
        Math.floor(world.props.x[id]!)));
      relocate((x, z) => cells.has(Math.floor(z) * world.cellsX + Math.floor(x)));
    },
    busy: () => terrain.stats.busy,
    canPlant: (x, z) => !world.settlementGroundClearance?.[Math.floor(z) * world.cellsX + Math.floor(x)],
    onEdit,
    selection: generatedFeatures.selection
  });
  const scenarioRoads = createScenarioRoadEditor(world, store, history, onEdit, viewport, renderer, i18n);
  const marbleEditor = createMarbleEditor(world, store, history, onEdit);
  const scenarioEditor = createScenarioEditor(world, store, history, onEdit, library.play);
  const scriptWindow = createScriptWindow(viewport, { i18n, mapExits: library.campaignExits, onEdit,
    onTestPlay: library.testPlay, store, world });
  library.setSaveGuard(scriptWindow.workspace.confirmDraftSave);
  openScriptDeepLink(scriptWindow);
  // Review hook (dev builds only): browser tests apply a deep link to the edited, unsaved script.
  if (import.meta.env.DEV) (window as Window & { __scriptWindow?: unknown }).__scriptWindow = scriptWindow;
  const scenarioOverlay = createScenarioOverlay(world, viewport, renderer, i18n,
    createCatapultMarkerSelection(store, scenarioEditor));
  const riverEditor = createRiverEditor(world, store, history, terrain, onEdit,
    cells => {
      relocate((x, z) => x >= cells.minX && x <= cells.maxX && z >= cells.minZ && z <= cells.maxZ &&
        !world.walkCost[Math.floor(z) * world.cellsX + Math.floor(x)]);
      refresher.afterTerrain({ cells, propsChanged: false, removed: [] });
    }, (ids, cells) => { onPropsRemoved(ids); renderer.mapEdit.removeProps(ids, cells); });

  /** The editor frame's overlays (hidden with the editor). */
  const draw = (enabled: boolean) => {
    scenarioOverlay.draw(enabled);
    scenarioSpace.draw(enabled);
    navigationOverlay.draw(enabled);
    harbourSpotOverlay.draw(enabled);
    generatedFeatures.draw(enabled);
    originalFeatures.draw(enabled);
    coastReshape.draw(enabled);
    scenarioRoads.draw(enabled);
    patrolEditor.draw(enabled);
  };

  return {
    coastReshape,
    decorationEditor,
    decorationPalette,
    draw,
    environmentDefaults,
    fishingWater,
    generatedFeatures,
    generatedTransforms,
    groundPalette,
    harbourSpotOverlay,
    marbleEditor,
    navigationOverlay,
    oreEditor,
    originalFeatures,
    patrolEditor,
    riverEditor,
    scenarioEditor,
    scenarioOverlay,
    scenarioRoads,
    scenarioSpace,
    scopedRestore,
    scriptWindow,
    terrainFeatures,
    vegetationRegrowth
  };
};
