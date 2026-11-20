import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createCoastReshapeEditor } from "../src/app/map-editor/coast-reshape-editor";
import { createDecorationEditor } from "../src/app/map-editor/decoration-editor";
import { createDecorationPaletteEditor } from "../src/app/map-editor/decoration-palette-editor";
import { GROUND_CHOICES } from "../src/app/map-editor/editor-catalog";
import { createEditorHistory } from "../src/app/map-editor/editor-history";
import type { EditorPanelControllers } from "../src/app/map-editor/editor-panel";
import type { EditRefresher } from "../src/app/map-editor/editor-refresh";
import { createEditorStore } from "../src/app/map-editor/editor-store";
import { createEnvironmentDefaultsEditor, toWeatherChoice } from "../src/app/map-editor/environment-defaults-editor";
import { createFishingWaterEditor } from "../src/app/map-editor/fishing-water-editor";
import { createGeneratedFeatureInspector } from "../src/app/map-editor/generated-feature-inspector";
import { createGeneratedFeatureTransformControls } from "../src/app/map-editor/generated-feature-transform-controls";
import { createGroundPaletteEditor } from "../src/app/map-editor/ground-palette-editor";
import type { MapLibrary, MapLibraryState } from "../src/app/map-editor/map-library";
import { createMarbleEditor } from "../src/app/map-editor/marble-editor";
import { editorMessage, MAP_EDITOR_MESSAGES, resolveEditorText } from "../src/app/map-editor/messages";
import { createNavigationOverlay } from "../src/app/map-editor/navigation-overlay";
import { createOreEditor } from "../src/app/map-editor/ore-editor";
import {
  createOriginalFeatureSelector, toOriginalFeatureOptions
} from "../src/app/map-editor/original-feature-selector";
import { getActionButtonLook, getActionIconKey } from "../src/app/map-editor/panel/action-icons";
import { EditorPanel } from "../src/app/map-editor/panel/editor-panel";
import { createTabContents } from "../src/app/map-editor/panel/editor-tabs";
import { getEditorTabRows, getStatusView, toChoiceSpecs,toToolRows } from "../src/app/map-editor/panel/helpers";
import { getTimberAppearance } from "../src/app/map-editor/panel/palette-helpers";
import { getSlotsNote } from "../src/app/map-editor/panel/use-map-section";
import { createPatrolEditor } from "../src/app/map-editor/patrol-editor";
import { createRiverEditor, getRiverDimensionFields, toRiverOptions } from "../src/app/map-editor/river-editor";
import { createScenarioEditor } from "../src/app/map-editor/scenario-editor";
import { createScenarioRoadEditor } from "../src/app/map-editor/scenario-road-editor";
import { type ScenarioEntry, toScenarioSelectionView } from "../src/app/map-editor/scenario-selection-controls";
import { createScenarioSpaceEditor, listSpaceFindings } from "../src/app/map-editor/scenario-space-editor";
import { createScopedTerrainRestoreEditor } from "../src/app/map-editor/scoped-terrain-restore-editor";
import { createScriptWorkspace } from "../src/app/map-editor/script/script-workspace";
import { createSectionStore, keepOption, toBoundedWhole, toValueAsNumber } from "../src/app/map-editor/section-store";
import { createTerrainFeatureEditor } from "../src/app/map-editor/terrain-feature-editor";
import type { TerrainTool } from "../src/app/map-editor/terrain-tool";
import { createVegetationRegrowthEditor } from "../src/app/map-editor/vegetation-regrowth-editor";
import type { TerrainRenderer } from "../src/render-common/renderer-contract";
import type { ScenarioWorldReport } from "../src/shared/settlement/scenario-world-inspection";
import { createTerrainEditState } from "../src/shared/world/editing/terrain/terrain-edit-state";
import { MATERIAL, PROP, type WorldData } from "../src/shared/world/world-data";
import { SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld } from "./helpers/cached-worlds";
import { createTestI18n } from "./helpers/render-with-i18n";

const noop = () => undefined;

describe("map editor section store", () => {
  it("publishes only real changes and reads fields like number inputs", () => {
    const section = createSectionStore({ count: "4.6", label: "a" });
    const listener = vi.fn();
    section.subscribe(listener);
    section.update({ label: "a" });
    expect(listener).not.toHaveBeenCalled();
    section.update({ count: "" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(section.valueAsNumber("count")).toBeNaN();
    expect(section.number("count", 1, 3)).toBe(1);
    expect(section.reportValidity("count")).toBe(true);
    expect(toBoundedWhole("7.6", 0, 3)).toBe(3);
    expect(toValueAsNumber(" 2.5")).toBe(2.5);
  });

  it("keeps a still offered choice, else the first option", () => {
    const options = [{ label: "A", value: "a" }, { label: "B", value: "b" }];
    expect(keepOption(options, "b")).toBe("b");
    expect(keepOption(options, "gone")).toBe("a");
    expect(keepOption([], "a")).toBe("");
  });
});

describe("map editor panel helpers", () => {
  it("gives each action meaning its own icon and every action a short caption", () => {
    expect(getActionIconKey("Apply river width/depth")).toBe("action:apply");
    expect(getActionIconKey("Validate patrol links")).toBe("action:register");
    expect(getActionIconKey("Erase river/waterfalls at click")).toBe("action:demolish");
    expect(getActionIconKey("Capture named terrain restore baseline")).toBe("map-save");
    expect(getActionIconKey("Restore selected contour to captured baseline")).toBe("map-load");
    expect(getActionIconKey("Cancel coast reshape preview")).toBe("action:cancel");
    expect(getActionIconKey("Retry map rebuild")).toBe("camera:reset");
    expect(getActionIconKey("Place HQ")).toBe("action:build");
    expect(getActionIconKey("Shape fishing lake habitat")).toBeUndefined();
    expect(getActionButtonLook("Shape fishing lake habitat")).toEqual({ caption: "Shape fishing lake habitat",
      icon: null });
    const look = getActionButtonLook("Regenerate selected contour interior from saved seed recipe", undefined,
      "Regenerate");
    expect(look.caption).toBe("Regenerate");
    expect(look.icon?.src).toContain("musicRepeat");
  });


  it("resolves tab labels through the active Lingui locale", () => {
    const hungarian = setupI18n({ locale: "hu", messages: { hu: {
      "mapEditor.tabs.terrain.name": "Domborzat és víz", "mapEditor.sections.terrain": "Terep"
    } } });
    expect(getEditorTabRows("map-editor-x", "terrain", "roman")[0]).toMatchObject({
      label: "Terrain", name: "Relief and water"
    });
    expect(getEditorTabRows("map-editor-x", "terrain", "roman", hungarian)[0]).toMatchObject({
      label: "Terep", name: "Domborzat és víz"
    });
  });

  it("selects one tab with the roving tab index and shows the scenario nation's soldier on Units", () => {
    const rows = getEditorTabRows("map-editor-x", "units", "viking");
    expect(rows.filter(row => row.selected).map(row => row.id)).toEqual(["units"]);
    expect(rows.map(row => row.tabIndex)).toEqual([-1, -1, 0, -1, -1, -1, -1, -1, -1]);
    expect(rows[2]).toMatchObject({ className: "map-editor__tab is-active", name: "Units and camps",
      panelId: "map-editor-x-panel-units", tabId: "map-editor-x-tab-units" });
    expect(rows[2]!.icon!.src).toContain("viking");
  });

  it("marks only the active tool and hides an empty hint", () => {
    const specs = toChoiceSpecs("ground", GROUND_CHOICES);
    const rows = toToolRows(specs, { kind: "ground", value: MATERIAL.sand });
    expect(rows.filter(row => row.active).map(row => row.action.label)).toEqual(["Sand"]);
    expect(getStatusView({ hint: "", hintIsRefusal: false }).hidden).toBe(true);
    expect(getStatusView({ hint: "Too steep there.", hintIsRefusal: true }).className)
      .toBe("map-editor__status is-refusal");
  });

  it("offers birch forms only for hardwood and shows timber appearance for the hardwood family", () => {
    const hardwood = getTimberAppearance({ hardwoodForm: 6, tool: { kind: "tree", value: PROP.hardwoodTree } });
    expect(hardwood).toMatchObject({ hidden: false, value: "6" });
    expect(hardwood.options).toHaveLength(10);
    const walnut = getTimberAppearance({ hardwoodForm: 6, tool: { kind: "tree", value: PROP.walnutTree } });
    expect(walnut).toMatchObject({ hidden: false, value: "-1" });
    expect(getTimberAppearance({ hardwoodForm: 1, tool: null }).hidden).toBe(true);
  });

  it("derives river, scenario selection, findings, weather, source and slot views", () => {
    const i18n = createTestI18n();
    const rivers = toRiverOptions({ authoredRivers: [{ id: 2 }], generatedRivers: [{ adopted: true, id: 1 }] } as never);
    expect(rivers.map(river => [resolveEditorText(i18n, river.label), river.value])).toEqual([
      ["Adopted river 1", "g:1"], ["Drawn river 2", "a:2"]
    ]);
    expect(getRiverDimensionFields(true)).toMatchObject({
      widthLabel: { id: "mapEditor.fields.riverWidthMultiplier", message: "River width multiplier" }, widthMin: ".25"
    });
    const point = { x: 1, z: 1 };
    const entries: ScenarioEntry[] = [["hq", "Headquarters", point], ["unit:3", "shield 3", point]];
    const view = toScenarioSelectionView(entries, "unit:3", "map");
    expect(view).toMatchObject({ moveDisabled: true, selected: "" });
    expect(view.options.map(option => option.value)).toEqual(["", "hq"]);
    expect(toScenarioSelectionView([["landing", "Landing", point]], "landing", "map").rotateDisabled).toBe(true);
    const report = { messages: Array(300).fill("m"), navigation: { findings: [], roadErrors: [] }, roads: [] };
    expect(listSpaceFindings(report as unknown as ScenarioWorldReport)).toHaveLength(257);
    expect(toWeatherChoice({ cycling: false, hour: 3, rain: false, snow: true })).toBe("snow");
    expect(toOriginalFeatureOptions(undefined)).toHaveLength(1);
    expect(resolveEditorText(undefined, toOriginalFeatureOptions(undefined)[0]!.label))
      .toBe("No original feature identities");
    expect(getSlotsNote({ slots: [], storage: false })).toEqual({
      note: { id: "mapEditor.library.blocked", message: "Browser storage is blocked here: save and load map files instead." },
      noteHidden: false });
  });
});

describe("map editor store tabs", () => {
  it("puts the tool away only when the category changes", () => {
    const store = createEditorStore();
    store.toggleTool("ground", MATERIAL.sand);
    store.setTab("terrain");
    expect(store.getState().tool).not.toBeNull();
    store.setHint("note");
    store.setTab("tiles");
    expect(store.getState()).toMatchObject({ hint: "", tab: "tiles", tool: null });
  });
});

/** Real section controllers on a small generated island; DOM overlays and renderer are inert stand-ins. */
const createControllers = (): EditorPanelControllers => {
  const world: WorldData = cachedWorld(SMALL_EDITOR_WORLD);
  const store = createEditorStore();
  const state = createTerrainEditState();
  const history = createEditorHistory({ animals: { list: () => [], place: () => true, remove: noop },
    flush: noop, isQueued: () => false, rebuild: noop, terrain: state, world });
  const terrain = { editFeature: () => null, flush: noop, rebuildArea: noop, retryRebuild: noop, state,
    stats: { busy: false } } as unknown as TerrainTool;
  const refresher = { finishStroke: noop, queue: noop } as unknown as EditRefresher;
  const renderer = { pickGround: () => null, projectToViewport: () => ({ depth: 0, x: 0, y: 0 }) } as unknown as
    TerrainRenderer;
  const viewport = { append: noop, clientHeight: 0, clientWidth: 0 } as unknown as HTMLElement;
  const libraryState: MapLibraryState = { busy: false, campaignSlot: null, catalog: null, catalogError: "",
    name: "Test island",
    slots: [{ id: "map-1", name: "Saved one", savedAt: 0, size: 1 }], storage: true };
  const library = { deleteSlot: noop, getState: () => libraryState, loadFile: noop, loadSlot: noop,
    overwriteSlot: noop, saveFile: noop, saveNewSlot: noop, setName: noop, subscribe: () => noop
  } as unknown as MapLibrary;
  const generatedFeatures = createGeneratedFeatureInspector(world, viewport, renderer);
  const decorations = createDecorationEditor(world, store, history, refresher, () => 1, noop);
  return {
    catalogWarning: null,
    close: noop,
    coast: createCoastReshapeEditor(world, viewport, renderer, terrain, history, store, noop, noop),
    decorationPalette: createDecorationPaletteEditor(world, store, history, decorations, noop),
    decorations,
    environment: createEnvironmentDefaultsEditor(world, history, store, noop),
    groundPalette: createGroundPaletteEditor(world, history, store, noop),
    fishing: createFishingWaterEditor(world, viewport, renderer, store),
    generatedFeatures,
    generatedTransforms: createGeneratedFeatureTransformControls(world, terrain, history, store,
      generatedFeatures.selection, noop, refresher),
    history,
    library,
    marble: createMarbleEditor(world, store, history, noop),
    navigation: createNavigationOverlay(world, viewport, renderer),
    ore: createOreEditor(world, store, history, refresher, noop),
    originalFeatures: createOriginalFeatureSelector(world, viewport, renderer, history, store, noop, () => false),
    patrol: createPatrolEditor(world, viewport, renderer, history, store, noop),
    river: createRiverEditor(world, store, history, terrain, noop, noop, noop),
    roads: createScenarioRoadEditor(world, store, history, noop),
    scenario: createScenarioEditor(world, store, history, noop, noop),
    scenarioSpace: createScenarioSpaceEditor(world, viewport, renderer, () => true),
    scopedRestore: createScopedTerrainRestoreEditor(world, terrain, history, store, () => null, noop),
    script: { close: noop, dispose: noop, open: noop, registerOpener: noop,
      workspace: createScriptWorkspace({ onEdit: () => true, store, world }) },
    store,
    terrainFeatures: createTerrainFeatureEditor(world, terrain, history, store, noop),
    vegetation: createVegetationRegrowthEditor(world, viewport, renderer, store, history, refresher, {
      adoptPlaced: noop, busy: () => false, canPlant: () => true, onEdit: noop, selection: () => null }),
    world
  };
};

describe("map editor panel markup", () => {
  let controllers: EditorPanelControllers;
  let tabs: Record<string, string>;
  const render = (node: ReactNode, i18n = createTestI18n()) =>
    renderToStaticMarkup(createElement(I18nProvider, { i18n }, node));
  beforeEach(() => {
    vi.stubGlobal("location", { pathname: "/", search: "" });
  });
  beforeAll(() => {
    vi.stubGlobal("document", { createElement: () => ({ setAttribute: noop, style: {} }) });
    vi.stubGlobal("location", { pathname: "/", search: "" });
    controllers = createControllers();
    const i18n = createTestI18n();
    tabs = Object.fromEntries(Object.entries(createTabContents(controllers)).map(([id, node]) => [id, render(node, i18n)]));
  });
  afterAll(() => { vi.unstubAllGlobals(); });

  it("renders the shell: title, close, history, eight icon tabs, brush levels and a hidden hint", () => {
    const markup = render(createElement(EditorPanel, controllers));
    expect(markup).toContain("<h2>Map editor</h2>");
    expect(markup).toContain('aria-label="Close map editor"');
    expect(markup).toContain('<div aria-label="Edit history" class="map-editor__history" role="toolbar">');
    expect(markup).toContain('aria-label="Undo (Ctrl+Z)" class="map-editor__tool map-editor__history-button" '
      + 'disabled=""');
    // The Map tab's start setup picker adds its own two tabs (wares, people).
    expect(markup.match(/class="map-editor__tab[ "]/g)).toHaveLength(9);
    expect(markup).toMatch(/aria-label="Relief and water" aria-selected="true" class="map-editor__tab is-active"/);
    const editorPanels = markup.replace(/<section aria-labelledby="map-rules-start-tab[^>]*>/g, "");
    expect(editorPanels.match(/role="tabpanel"/g)).toHaveLength(9);
    expect(editorPanels.match(/role="tabpanel" hidden=""|hidden="" id="[^"]+" role="tabpanel"/g)).toHaveLength(8);
    expect(markup).toContain("<span>Brush size: 3 cells</span>");
    expect(markup).toContain("<span>Brush strength: 100 %</span>");
    expect(markup).toContain('<p class="map-editor__status" hidden="" role="status"></p>');
  });

  it("shows the content version warning panel only for a map authored with another catalog version", () => {
    expect(render(createElement(EditorPanel, controllers))).not.toContain("map-editor__catalog-warning");
    const warning = { gameVersion: "11111111", mapVersion: "22222222" };
    const markup = render(createElement(EditorPanel, { ...controllers, catalogWarning: warning }));
    expect(markup).toContain('aria-label="Content version differs" class="map-editor__catalog-warning" role="alert"');
    expect(markup).toContain("(map 22222222, game 11111111)");
    expect(markup).toContain(">Dismiss</button>");
  });


  it("renders representative Hungarian panel copy and resolves dynamic messages", () => {
    const i18n = setupI18n({ locale: "hu", messages: { hu: {
      "mapEditor.brush.sizeLevel": "{size} cella",
      "mapEditor.brush.strengthLevel": "{percent} %",
      "mapEditor.catalog.tool.raiseGround": "Talaj emelése",
      "mapEditor.common.close": "Térképszerkesztő bezárása",
      "mapEditor.common.title": "Térképszerkesztő",
      "mapEditor.hints.garrisonCapacity": "Egész helyőrség legfeljebb {capacity}.",
      "mapEditor.sections.relief": "Domborzat",
      "mapEditor.tabs.terrain.name": "Domborzat és víz"
    } } });
    const markup = render(createElement(EditorPanel, controllers), i18n);
    expect(markup).toContain("<h2>Térképszerkesztő</h2>");
    expect(markup).toContain('aria-label="Térképszerkesztő bezárása"');
    expect(markup).toContain('aria-label="Domborzat és víz"');
    expect(markup).toContain("</svg>Domborzat");
    expect(markup).toContain('aria-label="Talaj emelése"');
    expect(markup).toContain("<span>Brush size: 3 cella</span>");
    expect(markup).toContain("<span>Brush strength: 100 %</span>");
    expect(resolveEditorText(i18n, editorMessage(MAP_EDITOR_MESSAGES.hints.garrisonCapacity, { capacity: 12 })))
      .toBe("Egész helyőrség legfeljebb 12.");
  });

  it("shows the brush only on tabs whose tools use it", () => {
    controllers.store.setTab("units");
    const units = render(createElement(EditorPanel, controllers));
    expect(units).not.toContain("Brush size:");
    expect(units).not.toContain("Brush strength:");
    controllers.store.setTab("terrain");
    expect(render(createElement(EditorPanel, controllers))).toContain("Brush size:");
  });

  it("Terrain: relief and brush tools, target height, rivers keep their accessible names", () => {
    const markup = tabs.terrain!;
    expect(markup).toContain('aria-label="Raise ground" aria-pressed="false" class="map-editor__tool" '
      + 'title="Raise ground"');
    expect(markup).toContain('aria-pressed="false" class="map-editor__tool"');
    expect(markup).toContain('<label class="map-editor__number-field settings-panel__select">Target height above sea'
      + '<input aria-label="Target height above sea" class="input-count" max="64" min="-32" step=".1" type="number" value="2"/></label>');
    // The island's generated river is selected: multipliers, with the field's accessible name unchanged.
    expect(markup).toContain('<label class="map-editor__number-field">River width multiplier<input '
      + 'aria-label="River width" class="input-narrow" max="4" min=".25" required="" step=".05" type="number" '
      + 'value="1"/></label>');
    expect(markup).toMatch(/aria-label="Apply river width\/depth" class="map-editor__action" title/);
    expect(markup).toContain("<span>Apply size</span></button>");
    expect(markup).toContain('<select aria-label="Editable river"');
    expect(markup).toContain('<button aria-label="Regenerate selected contour interior from saved seed recipe" '
      + 'class="map-editor__action" disabled="" title="Regenerate selected contour');
    expect(markup).toContain('class="map-editor__help-note"><span class="info-tooltip info-tooltip--blue"');
    expect(markup).toContain('aria-label="How it works"');
    expect(markup).toContain('aria-label="Include complete connected river courses" type="checkbox"');
    expect(markup).toContain("<h2>");
    expect(markup).toContain("Coast and island reshape preview");
    expect(markup).toMatch(/aria-label="Apply previewed coast reshape" class="map-editor__action" disabled=""/);
  });

  it("Tiles and Animals: tile palette, biome painting, animal age and population", () => {
    expect(tabs.tiles).toContain('aria-label="Mine gravel" aria-pressed="false" class="map-editor__tool" '
      + 'title="Mine gravel"');
    expect(tabs.tiles).toContain('<label>Terrain biome<select aria-label="Terrain biome">');
    expect(tabs.tiles).toMatch(/aria-label="Paint selected biome" aria-pressed="false" class="map-editor__action"/);
    expect(tabs.animals).toContain('aria-label="Deer"');
    expect(tabs.animals).toContain('<input aria-label="Animal population per placement" class="input-narrow" max="16" min="1" step="1" '
      + 'type="number" value="1"/>');
  });

  it("Units: a home shows only the scenario picker and a clear switch action", () => {
    const markup = tabs.units!;
    expect(markup).toContain('<label>Scenario<select aria-label="Scenario">');
    expect(markup).toContain('class="map-editor__empty-state"');
    expect(markup).toContain('<p class="map-editor__note">Enemies need an adventure or colony scenario');
    expect(markup).toContain('aria-label="Switch scenario to adventure"');
    expect(markup).not.toContain('aria-label="Enemy faction"');
    expect(markup).not.toContain("Garrison troop composition");
    expect(markup).not.toContain('aria-label="Place enemy group"');
    expect(markup).not.toContain('aria-label="Authored object"');
    expect(markup).not.toContain('aria-label="Patrolling enemy unit"');
  });

  it("Deposits, Trees and Objects: stone, ore, marble, fishing, tree palette and decorations", () => {
    expect(tabs.deposits).toContain('<h3 class="map-editor__subheading">Ore (on mine gravel)</h3>');
    expect(tabs.deposits).toContain('aria-label="Deposit amount"');
    expect(tabs.deposits).toContain('aria-label="Place marble deposit"');
    expect(tabs.deposits).toContain('aria-label="Quarry stone boulder"');
    expect(tabs.deposits).toMatch(/<p role="status">\d+ cells · \d+ ore remaining/);
    expect(tabs.trees).toContain('<label hidden="">Timber appearance<select aria-label="Timber appearance">');
    expect(tabs.trees).toMatch(/aria-label="Place tree for local biome" aria-pressed="false" class="map-editor__action"/);
    expect(tabs.trees).toContain(">Sapling (30s)</option>");
    expect(tabs.objects).toMatch(/aria-label="Select decoration on map" aria-pressed="false"/);
    expect(tabs.objects).toContain('aria-label="Remove objects: trees, plants and stones"');
    expect(tabs.objects).toContain('<input aria-label="Decoration scale" class="input-narrow" max="1.5" min=".5" '
      + 'step=".01" type="number" value="1"/>');
  });

  it("Map: scenario, inspection, roads, weather and the map library with confirmed slot actions", () => {
    const markup = tabs.map!;
    expect(markup).toContain('<label>Scenario<select aria-label="Scenario"><option value="home" selected="">Home');
    expect(markup).toContain('<label class="settings-panel__select">Next generated map resources<select');
    expect(markup).toContain('<select aria-label="Authored HQ or landing" hidden="">');
    expect(markup).toContain("<span>Place HQ</span></button>");
    expect(markup).toContain("</svg>Map rules<span");
    expect(markup).toContain('aria-label="Use the nation&#x27;s default start stock"');
    expect(markup).toContain("Nation default stock");
    expect(markup).toContain('aria-busy="false" class="map-editor__authoring-controls"');
    expect(markup).not.toContain("data-startup-spatial");
    expect(markup).toContain('<label class="map-editor__name">Name<input maxLength="40" type="text" '
      + 'value="Test island"/>');
    expect(markup).toContain('<li class="map-editor__slot"><span class="map-editor__slot-name" title="Saved one">'
      + "Saved one");
    expect(markup).toContain('aria-label="Delete this saved map" class="map-editor__slot-button"');
    expect(markup).toContain('<p class="map-editor__help" hidden="">No maps saved in this browser yet.</p>');
  });
});
