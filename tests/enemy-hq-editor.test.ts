import { beforeAll, describe, expect, it } from "vitest";

import { createEditorHistory } from "../src/app/map-editor/editor-history";
import { createEditorStore } from "../src/app/map-editor/editor-store";
import { resolveEditorText } from "../src/app/map-editor/messages";
import { createScenarioEditor } from "../src/app/map-editor/scenario-editor";
import { ENEMY_BUILDINGS } from "../src/app/map-editor/scenario-form-controls";
import { validateMapScenario } from "../src/shared/settlement/settlement-map-scenario";
import { createMapScenario, isMapScenario, type ScenarioBuilding } from "../src/shared/world/map-scenario";
import { createTerrainEditState } from "../src/shared/world/editing/terrain/terrain-edit-state";
import type { WorldData } from "../src/shared/world/world-data";
import { findOpenSpots, SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld } from "./helpers/cached-worlds";
import { createTestI18n } from "./helpers/render-with-i18n";

const noop = () => undefined;
const i18n = createTestI18n();
const text = (value: Parameters<typeof resolveEditorText>[1]) => resolveEditorText(i18n, value);

const createHistory = (world: WorldData) => createEditorHistory({
  animals: { list: () => [], place: () => true, remove: noop },
  flush: noop, isQueued: () => false, rebuild: noop, terrain: createTerrainEditState(), world
});

const createEditor = (world: WorldData) => {
  const store = createEditorStore();
  const editor = createScenarioEditor(world, store, createHistory(world), noop, noop);
  return { editor, store };
};

describe("editor enemy headquarters", () => {
  beforeAll(() => { cachedWorld(SMALL_EDITOR_WORLD); }, 60_000);

  it("offers the AI depot building in the enemy building picker", () => {
    expect(ENEMY_BUILDINGS.find(option => option.value === "0")?.label).toBeDefined();
    expect(text(ENEMY_BUILDINGS.find(option => option.value === "0")!.label)).toBe("Enemy headquarters (AI depot)");
  });

  it("refuses an enemy HQ when the selected faction has no computer AI", () => {
    const world = cachedWorld(SMALL_EDITOR_WORLD);
    world.scenario = { ...createMapScenario(), kind: "adventure" };
    const { editor, store } = createEditor(world);
    const spots = findOpenSpots(world, 2, 8);
    editor.setEnemyBuilding("0");
    editor.activate("building", "units");
    editor.stamp(spots[0]!);
    expect(world.scenario.buildings).toEqual([]);
    expect(store.getState().hintIsRefusal).toBe(true);
    expect(text(store.getState().hint)).toBe(
      "Give this faction a computer AI mode before placing its headquarters.");
  });

  it("places a zero-defender enemy HQ for an active AI faction and validates the map", () => {
    const world = cachedWorld(SMALL_EDITOR_WORLD);
    const spots = findOpenSpots(world, 8, 4);
    let editor: ReturnType<typeof createEditor>["editor"] | undefined;
    let entry: ScenarioBuilding | undefined;
    for (const spot of spots) {
      world.scenario = { ...createMapScenario(), kind: "adventure", landing: { ...spots[7]! },
        factionAi: [{ faction: 1, mode: "develop", start: { settlers: 4, stock: {} } }] };
      editor = createEditor(world).editor;
      editor.setEnemyBuilding("0");
      editor.activate("building", "units");
      editor.stamp(spot);
      entry = world.scenario.buildings[0];
      if (!validateMapScenario(world).some(error => error.startsWith("Building "))) break;
    }
    expect(editor?.unitsSection.get().defenders).toBe("0");
    expect(entry).toMatchObject({ faction: 1, type: 0, defenders: 0 });
    expect(isMapScenario(world.scenario, world.cellsX, world.cellsZ)).toBe(true);
    expect(validateMapScenario(world)).toEqual([]);
  });

  it("keeps a type-0 building invalid for a faction whose AI mode is none", () => {
    const world = cachedWorld(SMALL_EDITOR_WORLD);
    const spots = findOpenSpots(world, 2, 8);
    const scenario = { ...createMapScenario(), kind: "adventure" as const, landing: { ...spots[1]! },
      factionAi: [{ faction: 1, mode: "none" as const }],
      buildings: [{ id: 1, x: spots[0]!.x, z: spots[0]!.z, rotation: 0, type: 0,
        faction: 1, defenders: 0 }] };
    world.scenario = scenario;
    expect(isMapScenario(scenario, world.cellsX, world.cellsZ)).toBe(false);
  });
});
