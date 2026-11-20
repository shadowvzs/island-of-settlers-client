import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import type { WorldData } from "../../shared/world/world-data";
import { createLazyReactContent } from "../components/lazy-react-content";
import { registerSettlementWindowOrder } from "../settlement-ui/window-order";
import { getWindowLayer, isolatePointer } from "../window-layer";
import type { CatalogVersionWarning } from "./catalog-version/helpers";
import type { CoastReshapeEditor } from "./coast-reshape-editor";
import type { DecorationEditor } from "./decoration-editor";
import type { DecorationPaletteEditor } from "./decoration-palette-editor";
import type { EditorHistory } from "./editor-history";
import type { EditorStore } from "./editor-store";
import type { EnvironmentDefaultsEditor } from "./environment-defaults-editor";
import type { FishingWaterEditor } from "./fishing-water-editor";
import type { GeneratedFeatureInspector } from "./generated-feature-inspector";
import type { GeneratedFeatureTransformControls } from "./generated-feature-transform-controls";
import type { GroundPaletteEditor } from "./ground-palette-editor";
import type { MapLibrary } from "./map-library";
import type { MarbleEditor } from "./marble-editor";
import { MAP_EDITOR_MESSAGES as M } from "./messages";
import type { NavigationOverlay } from "./navigation-overlay";
import type { OreEditor } from "./ore-editor";
import type { OriginalFeatureSelector } from "./original-feature-selector";
import type { PatrolEditor } from "./patrol-editor";
import type { RiverEditor } from "./river-editor";
import type { ScenarioEditor } from "./scenario-editor";
import type { ScenarioRoadEditor } from "./scenario-road-editor";
import type { ScenarioSpaceEditor } from "./scenario-space-editor";
import type { ScopedTerrainRestoreEditor } from "./scoped-terrain-restore-editor";
import type { ScriptWindow } from "./script/script-window";
import type { TerrainFeatureEditor } from "./terrain-feature-editor";
import type { VegetationRegrowthEditor } from "./vegetation-regrowth-editor";

/** The section controllers the panel renders (their logic, overlays and workers stay in TypeScript). */
export interface EditorPanelControllers {
  /** Shown once on top when the loaded map was authored with another content catalog version. */
  catalogWarning: CatalogVersionWarning | null;
  /** Leaves the editor (the development toggle mirrors the same visibility). */
  close: () => void;
  coast: CoastReshapeEditor;
  decorationPalette: DecorationPaletteEditor;
  decorations: DecorationEditor;
  environment: EnvironmentDefaultsEditor;
  fishing: FishingWaterEditor;
  generatedFeatures: GeneratedFeatureInspector;
  generatedTransforms: GeneratedFeatureTransformControls;
  groundPalette: GroundPaletteEditor;
  history: EditorHistory;
  library: MapLibrary;
  marble: MarbleEditor;
  navigation: NavigationOverlay;
  ore: OreEditor;
  originalFeatures: OriginalFeatureSelector;
  patrol: PatrolEditor;
  /** In-page replacement generation; absent keeps the generator's reload path. */
  replacement?: (choice: import("../map-generator/helpers").IslandChoice, seed?: number) => void;
  river: RiverEditor;
  roads: ScenarioRoadEditor;
  scenario: ScenarioEditor;
  scenarioSpace: ScenarioSpaceEditor;
  scopedRestore: ScopedTerrainRestoreEditor;
  /** The Script workspace window (triggers, actors, templates; TRG11). */
  script: ScriptWindow;
  store: EditorStore;
  terrainFeatures: TerrainFeatureEditor;
  vegetation: VegetationRegrowthEditor;
  world: WorldData;
}

/**
 * The editor's frame (`aside.map-editor` in the window layer: pointer isolation, stacking order, visibility).
 * Its categorized React content loads on the first open, so React stays out of the startup bundle.
 */
export const createEditorPanel = (viewport: HTMLElement, controllers: EditorPanelControllers, i18n?: I18n) => {
  const root = document.createElement("aside");
  root.className = "map-editor";
  const updateLabel = () => root.setAttribute("aria-label", translateMessage(i18n, M.common.title));
  updateLabel();
  const unsubscribeLocale = i18n?.on("change", updateLabel);
  const inputEvents = new AbortController();
  isolatePointer(root, undefined, inputEvents.signal);
  getWindowLayer(viewport).append(root);
  const windowOrder = new AbortController();
  const activate = registerSettlementWindowOrder(root, windowOrder.signal);
  const heading = translateMessage(i18n, M.common.title);
  const content = createLazyReactContent(root, heading, async () =>
    (await import("./panel/mount-editor-panel")).createEditorPanelMount(controllers), {
    error: name => translateMessage(i18n, M.common.loadFailed, { heading: name }),
    loading: name => translateMessage(i18n, M.common.loading, { heading: name })
  });

  return {
    dispose: () => {
      content.dispose();
      unsubscribeLocale?.();
      inputEvents.abort();
      windowOrder.abort();
      root.remove();
    },
    setVisible: (visible: boolean) => {
      root.hidden = !visible;
      if (!visible) return;
      content.mount();
      activate();
    }
  };
};
