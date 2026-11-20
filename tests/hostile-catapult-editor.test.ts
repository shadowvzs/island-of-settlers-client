import { I18nProvider } from "@lingui/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { createEditorHistory } from "../src/app/map-editor/editor-history";
import { createEditorStore } from "../src/app/map-editor/editor-store";
import { ScenarioMapSection, ScenarioUnitsSection } from "../src/app/map-editor/panel/scenario-sections";
import { createCatapultMarkerSelection } from "../src/app/map-editor/scenario-catapult-helpers";
import { createScenarioEditor } from "../src/app/map-editor/scenario-editor";
import { createTerrainEditState } from "../src/shared/world/editing/terrain/terrain-edit-state";
import { createMapScenario, isMapScenario } from "../src/shared/world/map-scenario";
import { readMapFile } from "../src/shared/world/save/map-reader";
import { writeMapFile } from "../src/shared/world/save/map-writer";
import { SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld } from "./helpers/cached-worlds";
import { createTestI18n } from "./helpers/render-with-i18n";

const noop = () => {};

it.each(["bandit", "pirate"] as const)("authors %s Catapult identity, finite stock and roster through editor and map roundtrip", async variant => {
  const world = cachedWorld(SMALL_EDITOR_WORLD);
  world.scenario = { ...createMapScenario(), kind: "adventure", landing: { x: 14, z: 14 } };
  const history = createEditorHistory({
    animals: { list: () => [], place: () => true, remove: noop },
    flush: noop, isQueued: () => false, rebuild: noop, terrain: createTerrainEditState(), world
  });
  const editor = createScenarioEditor(world, createEditorStore(), history, noop, noop);
  editor.setEnemyBuilding(`${variant}-catapult`);
  expect(editor.unitsSection.get().defenders).toBe("2");
  editor.unitsSection.update({ catapultStones: "4" });
  editor.activate("building", "units"); editor.stamp({ x: 28, z: 12 });
  const entry = world.scenario.buildings[0]!;
  expect(entry).toMatchObject({ type: 16, defenders: 2, x: 28.5, z: 12.5,
    catapult: { variant, stones: 4 } });
  expect(entry.bandit).toBeUndefined();
  expect(isMapScenario(world.scenario, world.cellsX, world.cellsZ)).toBe(true);
  const restored = await readMapFile(await writeMapFile(world,
    { name: "Hostile Catapult", source: "acceptance", savedAt: 1, animals: [] }));
  expect(restored.world.scenario).toEqual(world.scenario);
  editor.unitsSection.update({ building: "2", model: "lodge-1", defenders: "1" });
  editor.applySelectedEnemy();
  expect(world.scenario.buildings[0]).toMatchObject({ type: 2, bandit: { code: 0, layout: 1 }, enclosure: "building" });
  expect(world.scenario.buildings[0]!.catapult).toBeUndefined();
  editor.unitsSection.update({ building: `${variant}-catapult`, catapultStones: "0", defenders: "1" });
  editor.applySelectedEnemy();
  expect(world.scenario.buildings[0]).toMatchObject({ type: 16, catapult: { variant, stones: 0 } });
  expect(world.scenario.buildings[0]!.bandit).toBeUndefined();
  expect(world.scenario.buildings[0]!.enclosure).toBeUndefined();
});

it("edits a selected tower draft with canonical roof/ground stock and history, without changing identity", async () => {
  const world = cachedWorld(SMALL_EDITOR_WORLD);
  world.scenario = { ...createMapScenario(), kind: "adventure", buildings: [{ id: 7, x: 28.5, z: 12.5,
    rotation: 2, type: 16, faction: 3, defenders: 2, catapult: { variant: "pirate", stones: 6 } }] };
  const history = createEditorHistory({ animals: { list: () => [], place: () => true, remove: noop },
    flush: noop, isQueued: () => false, rebuild: noop, terrain: createTerrainEditState(), world });
  const editor = createScenarioEditor(world, createEditorStore(), history, noop, noop);
  editor.activate("select", "units"); editor.stamp({ x: 28.5, z: 12.5 });
  const draft = editor.catapultInspector;
  expect(draft.section.get()).toMatchObject({ visible: true, roof: "2", ground: "4" });
  draft.section.update({ roof: "1", ground: "3", "heavy:0": "0", "heavy:2": "1", "shield:0": "0", "shield:1": "2" });
  expect(world.scenario.buildings[0]!.catapult!.stones).toBe(6);
  expect(draft.apply()).toBe(true);
  expect(world.scenario.buildings[0]).toMatchObject({ id: 7, faction: 3, rotation: 2, defenders: 3,
    catapult: { variant: "pirate", stones: 4, roofStones: 1 },
    garrison: [{ type: "shield", rank: 1, count: 2 }, { type: "heavy", rank: 2, count: 1 }] });
  history.undo(); expect(world.scenario!.buildings[0]!.catapult).toEqual({ variant: "pirate", stones: 6 });
  history.redo(); expect(world.scenario!.buildings[0]!.catapult).toEqual({ variant: "pirate", stones: 4, roofStones: 1 });
  draft.section.update({ roof: "2", ground: "5" }); expect(draft.apply()).toBe(false);
  draft.cancel(); expect(draft.section.get()).toMatchObject({ roof: "1", ground: "3" });
  draft.section.update({ "heavy:2": "0" }); expect(draft.apply()).toBe(false);
  draft.cancel();
  const restored = await readMapFile(await writeMapFile(world,
    { name: "Clicked tower", source: "acceptance", savedAt: 1, animals: [] }));
  expect(restored.world.scenario!.buildings).toEqual(world.scenario!.buildings);
  editor.remove("units"); expect(world.scenario!.buildings).toHaveLength(0);
  expect(draft.section.get().visible).toBe(false);
  history.undo(); expect(world.scenario!.buildings[0]!.id).toBe(7);
});


it("routes an actual marker callback into Units selection and exits placement without adding another tower", () => {
  const world = cachedWorld(SMALL_EDITOR_WORLD);
  world.scenario = { ...createMapScenario(), kind: "adventure" };
  const store = createEditorStore();
  const history = createEditorHistory({ animals: { list: () => [], place: () => true, remove: noop },
    flush: noop, isQueued: () => false, rebuild: noop, terrain: createTerrainEditState(), world });
  const editor = createScenarioEditor(world, store, history, noop, noop);
  editor.setEnemyBuilding("bandit-catapult"); editor.activate("building", "units");
  editor.stamp({ x: 28.5, z: 12.5 });
  const entry = world.scenario.buildings[0]!;
  createCatapultMarkerSelection(store, editor)(entry.id);
  expect(store.getState().tab).toBe("units");
  expect(editor.catapultInspector.section.get()).toMatchObject({ visible: true, id: entry.id });
  editor.stamp(entry);
  expect(world.scenario.buildings).toHaveLength(1);
});


it("renders the exact production inspector and authoring labels used by the focused native proof", () => {
  const world = cachedWorld(SMALL_EDITOR_WORLD);
  world.scenario = { ...createMapScenario(), kind: "adventure", buildings: [{ id: 4, type: 16,
    x: 28.5, z: 12.5, rotation: 0, faction: 2, defenders: 2, catapult: { variant: "bandit", stones: 6 } }] };
  const history = createEditorHistory({ animals: { list: () => [], place: () => true, remove: noop },
    flush: noop, isQueued: () => false, rebuild: noop, terrain: createTerrainEditState(), world });
  const editor = createScenarioEditor(world, createEditorStore(), history, noop, noop);
  editor.select("units", "building:4");
  const markup = renderToStaticMarkup(createElement(I18nProvider, { i18n: createTestI18n() },
    createElement("div", {}, createElement(ScenarioMapSection, { editor }), createElement(ScenarioUnitsSection, { editor }))));
  for (const label of ["Scenario", "Place HQ", "Place landing", "Enemy building", "Enemy faction",
    "Place enemy building", "Stones on roof", "Stones below", "Heavy infantry rank 1 count",
    "Heavy infantry rank 3 count", "Shield rank 1 count", "Shield rank 2 count",
    "Apply Catapult changes", "Cancel Catapult changes", "Remove selected"])
    expect(markup).toContain(`aria-label="${label}"`);
  expect(markup).toContain("Selected Catapult");
  expect(markup).not.toContain("Archer rank");
});
