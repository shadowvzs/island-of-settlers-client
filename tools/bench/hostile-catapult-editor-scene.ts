import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

import { createEditorHistory } from "../../src/app/map-editor/editor-history";
import { createEditorStore } from "../../src/app/map-editor/editor-store";
import { ScenarioUnitsSection } from "../../src/app/map-editor/panel/scenario-sections";
import { createScenarioEditor } from "../../src/app/map-editor/scenario-editor";
import { createScenarioOverlay } from "../../src/app/map-editor/scenario-overlay";
import { messages } from "../../src/locales/en/messages";
import type { TerrainRenderer } from "../../src/render-common/renderer-contract";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { validateMapScenario } from "../../src/shared/settlement/settlement-map-scenario";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { createTerrainEditState } from "../../src/shared/world/editing/terrain/terrain-edit-state";
import { DEFAULT_WORLD_OPTIONS, generateWorld } from "../../src/shared/world/generation/generate-world";
import { createMapScenario } from "../../src/shared/world/map-scenario";
import { readMapFile } from "../../src/shared/world/save/map-reader";
import { writeMapFile } from "../../src/shared/world/save/map-writer";
import { BUILD } from "../../src/shared/world/world-data";

const noop = () => {};

/** Real production editor controls/overlay on an explicitly synthetic flat coordinate fixture. */
export const setupHostileCatapultEditor = () => {
  i18n.load("en", messages); i18n.activate("en");
  const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, forest: 0,
    mountains: 0, rivers: 0, erosionDroplets: 0 });
  world.heights.fill(2); world.waterSurface.fill(0); world.waterDepth.fill(0);
  world.blocking.fill(0); world.walkCost.fill(10); world.buildClass.fill(BUILD.large);
  world.buildCap.fill(BUILD.large); world.slopeClass.fill(0); world.props.count = 0;
  world.scenario = { ...createMapScenario(), kind: "colony", settlers: 0,
    headquarters: { x: 8, z: 8, rotation: 0 }, landing: { x: 14, z: 14 } };
  const history = createEditorHistory({ animals: { list: () => [], place: () => true, remove: noop },
    flush: noop, isQueued: () => false, rebuild: noop, terrain: createTerrainEditState(), world });
  const editor = createScenarioEditor(world, createEditorStore(), history, noop, noop);
  const panel = document.querySelector<HTMLElement>("#panel")!;
  const map = document.querySelector<HTMLElement>("#map")!;
  const react = createRoot(panel);
  react.render(createElement(I18nProvider, { i18n }, createElement(ScenarioUnitsSection, { editor })));
  const overlay = createScenarioOverlay(world, map, {
    projectToViewport: (x: number, _y: number, z: number) => ({ x: x * 10, y: z * 10 })
  } as TerrainRenderer, i18n);
  map.onclick = event => {
    const bounds = map.getBoundingClientRect();
    editor.stamp({ x: (event.clientX - bounds.x) / 10, z: (event.clientY - bounds.y) / 10 });
    overlay.draw(true);
  };
  return { editor, world, verify: async () => {
    const diagnostics = validateMapScenario(world);
    const restored = await readMapFile(await writeMapFile(world,
      { name: "Hostile UI fixture", source: "acceptance", savedAt: 1, animals: [] }));
    const simulation = createSettlementSimulation({ world: restored.world, roads: createRoadNetwork(restored.world) });
    const saved = simulation.saveState();
    const towers = saved.buildings.filter(site => site.typeId === 16).map(site => ({
      variant: site.enemyCatapultVariant, faction: site.militaryFaction, roof: site.input.stone,
      ground: site.catapultSupply?.ground, staff: saved.actors.find(actor => actor.uid === site.worker),
      crew: saved.military?.soldiers.filter(soldier => soldier.building === site.uid)
    }));
    return { diagnostics, authored: world.scenario, restored: restored.world.scenario, towers,
      reload: simulation.loadState(saved), friendlyPeople: simulation.population().people };
  }, dispose: () => { overlay.dispose(); react.unmount(); map.onclick = null; } };
};
