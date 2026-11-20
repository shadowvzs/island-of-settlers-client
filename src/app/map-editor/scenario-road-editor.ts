import type { I18n } from "@lingui/core";

import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { ROAD_APPEARANCE } from "../../render-common/road-appearance";
import { ROAD_TIERS, snapRoadPoint } from "../../shared/settlement/road-types";
import { createScenarioRoadNetwork } from "../../shared/settlement/scenario-road-placement";
import { rotatedFootprint } from "../../shared/settlement/settlement-debug-raise";
import { createScenarioInspectionContext } from "../../shared/settlement/settlement-map-scenario";
import { makeBuilding, placementReason } from "../../shared/settlement/settlement-placement";
import type { MapScenario, ScenarioPoint } from "../../shared/world/map-scenario";
import { MAX_SCENARIO_ROADS } from "../../shared/world/scenario-roads";
import type { WorldData } from "../../shared/world/world-data";
import type { EditorHistory } from "./editor-history";
import type { EditorStore } from "./editor-store";
import { bumpBuildRevision } from "./helpers";
import { editorMessage, type EditorText, MAP_EDITOR_MESSAGES as M } from "./messages";
import { createScenarioRoadOverlay } from "./scenario-road-overlay";
import { createSectionStore } from "./section-store";

/** The infrastructure actions: a road per tier, then road removal and the harbour reservation. */
export const ROAD_ACTIONS = [...ROAD_TIERS.map(tier => `${ROAD_APPEARANCE[tier].label} road`), "Remove road",
  "Reserve harbour"];
const ROAD_TIER_MESSAGES = {
  basalt: M.road.basaltRoad, dirt: M.road.dirtRoad, granite: M.road.graniteRoad,
  limestone: M.road.limestoneRoad, marble: M.road.marbleRoad, stone: M.road.stoneRoad
} as const;
export const ROAD_ACTION_MESSAGES: readonly EditorText[] = [
  ...ROAD_TIERS.map(tier => ROAD_TIER_MESSAGES[tier]), M.road.removeRoad, M.road.reserveHarbour
];
const REMOVE_ROAD = ROAD_TIERS.length;
const RESERVE_HARBOUR = ROAD_TIERS.length + 1;

const describeRoads = (scenario: MapScenario | undefined): EditorText => scenario?.harbourPlot
  ? editorMessage(M.road.statusHarbour, {
    edges: scenario.roads?.length ?? 0, x: scenario.harbourPlot.x, z: scenario.harbourPlot.z
  })
  : editorMessage(M.road.status, { edges: scenario?.roads?.length ?? 0 });

/** Authored infrastructure is explicit map data, never a free-build action in a live settlement. */
export const createScenarioRoadEditor = (world: WorldData, store: EditorStore,
  history: EditorHistory, onEdit: () => boolean | void, viewport?: HTMLElement, renderer?: TerrainRenderer,
  i18n?: I18n) => {
  const section = createSectionStore({ mode: ROAD_ACTIONS[0]!, rotation: "0", status: "" as EditorText });
  const modeIndex = () => ROAD_ACTIONS.indexOf(section.get().mode);
  const rotation = () => section.number("rotation", 0, 3);
  let start: ScenarioPoint | undefined;
  const render = () => {
    start = undefined;
    section.update({ status: describeRoads(world.scenario) });
  };
  const mutate = (next: MapScenario) => {
    if (onEdit() === false) return;
    history.transaction(() => { world.scenario = next; bumpBuildRevision(world); });
    render();
  };
  const drawSelected = () => {
    store.toggleTool("scenarioRoad", modeIndex()); start = undefined;
    store.setHint(modeIndex() === RESERVE_HARBOUR ? M.hints.harbourClick : M.hints.roadClickStart);
  };
  const setMode = (mode: string) => { section.update({ mode }); start = undefined; store.clearTool(); };
  store.subscribe(() => { if (store.getState().tool?.kind !== "scenarioRoad") start = undefined; });
  history.subscribe(render); render();
  const reserveHarbour = (scenario: MapScenario, point: ScenarioPoint) => {
    const context = createScenarioInspectionContext(world);
    const { depth, width } = rotatedFootprint(39, rotation());
    const x = Math.round(point.x - width / 2) + width / 2;
    const z = Math.round(point.z - depth / 2) + depth / 2;
    const draft = makeBuilding(context, 39, x, z, rotation());
    const reason = placementReason(context, draft);
    if (reason) { store.setHint(reason, true); return; }
    mutate({ ...scenario, harbourPlot: { x: draft.x, z: draft.z, rotation: draft.rotation } });
    store.setHint(M.hints.harbourPasses);
  };
  const stamp = (point: ScenarioPoint) => {
    const scenario = world.scenario;
    if (!scenario) { store.setHint(M.hints.scenarioConfigureFirst, true); return; }
    const mode = modeIndex();
    if (mode === RESERVE_HARBOUR) { reserveHarbour(scenario, point); return; }
    const context = createScenarioInspectionContext(world);
    const end = snapRoadPoint(point);
    if (!start) { start = end; store.setHint(editorMessage(M.hints.roadStart, { x: end.x, z: end.z })); return; }
    const first = start; start = undefined;
    // The reservation protects its real footprint and signpost while drawing future approaches.
    if (scenario.harbourPlot && mode !== REMOVE_ROAD) {
      const harbour = scenario.harbourPlot;
      const draft = makeBuilding(context, 39, harbour.x, harbour.z, harbour.rotation);
      const reason = placementReason(context, draft);
      if (reason) { store.setHint(editorMessage(M.hints.harbourFirst, { reason }), true); return; }
      context.buildings.push(draft);
      for (let z = draft.z - draft.depth / 2; z < draft.z + draft.depth / 2; z++)
        for (let x = draft.x - draft.width / 2; x < draft.x + draft.width / 2; x++)
          context.occupied[z * world.cellsX + x] = 1;
    }
    const roads = createScenarioRoadNetwork(context);
    roads.replaceSegments(scenario.roads ?? []);
    if (mode === REMOVE_ROAD) {
      const route = roads.route(first, end);
      if (!route) { store.setHint(M.hints.roadExistsFirst, true); return; }
      for (let index = 1; index < route.points.length; index++)
        roads.removeRoad(route.points[index - 1]!, route.points[index]!);
    } else {
      if (!roads.addRoad(first, end)) { store.setHint(M.hints.roadNoLegalRoute, true); return; }
      for (const tier of ROAD_TIERS.slice(1, mode + 1))
        if (tier !== "dirt") roads.upgradeRoad(first, end, () => true, tier);
    }
    const segments = roads.segments();
    if (segments.length > MAX_SCENARIO_ROADS) { store.setHint(M.hints.roadLimit, true); return; }
    mutate({ ...scenario, roads: segments }); store.setHint(M.hints.roadUpdated);
  };
  const draw = viewport && renderer ? createScenarioRoadOverlay(world, viewport, renderer, i18n) : () => {};
  return {
    cancelStart: () => { start = undefined; store.setHint(M.hints.roadStartCleared); },
    draw,
    drawSelected,
    removeHarbour: () => { if (world.scenario) mutate({ ...world.scenario, harbourPlot: undefined }); },
    removeRoads: () => { if (world.scenario) mutate({ ...world.scenario, roads: [] }); },
    section,
    setMode,
    stamp
  };
};

export type ScenarioRoadEditor = ReturnType<typeof createScenarioRoadEditor>;
