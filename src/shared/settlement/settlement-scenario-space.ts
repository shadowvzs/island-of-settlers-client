import { getBuildingDefinition } from "../../render-common/buildings/building-catalog";
import type { WorldData } from "../world/world-data";
import type { RoadSegment } from "./road-types";
import { createScenarioRoadNetwork } from "./scenario-road-placement";
import { orderScenarioSpaceCandidates } from "./scenario-space-candidate-order";
import { scenarioSpaceCandidates,scenarioSpaceStages } from "./scenario-space-plan";
import type { ScenarioWildlifeSnapshot } from "./scenario-wildlife-inspection";
import {
  createScenarioWorkspaceInspector,
  type ScenarioWorkWitness
} from "./scenario-workspace-inspection";
import { shoreCells } from "./settlement-debug-harbour";
import { legalDraft, rotatedFootprint } from "./settlement-debug-raise";
import { findOwnHeadquarters } from "./settlement-home";
import { createScenarioInspectionContext, validateMapScenario } from "./settlement-map-scenario";
import { makeBuilding, placementReason } from "./settlement-placement";
import { settlementTerritory } from "./settlement-territory";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

export interface ScenarioSpaceSite {
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation: number;
  typeId: number;
}
interface ScenarioSpaceStage {
  name: string;
  mandatory: boolean;
  required: number[];
  found: number[];
  unknown: number[];
}
export interface ScenarioSpaceReport {
  expansion: ScenarioSpaceSite[];
  harbours: ScenarioSpaceSite[];
  expansionChecks: number;
  harbourChecks: number;
  messages: string[];
  stages: ScenarioSpaceStage[];
  roads: RoadSegment[];
  /** Positive witness for this fixed spatial plan only; never a negative suitability proof. */
  spatialPlanProved: boolean;
  startupSpatialProved: boolean;
  authoredErrors: string[];
  workspaces: ScenarioWorkWitness[];
  candidateCount: number;
  budgetExhausted: boolean;
  durationMs: number;
}
const site = (building: SettlementBuilding): ScenarioSpaceSite => ({
  x: building.x,
  z: building.z,
  width: building.width,
  depth: building.depth,
  rotation: building.rotation,
  typeId: building.typeId
});
const reservePlot = (context: SettlementContext, building: SettlementBuilding) => {
  context.nextBuilding = Math.max(context.nextBuilding, building.uid + 1);
  context.buildings.push(building);
  context.navigationRevision = (context.navigationRevision ?? 0) + 1;
  const { cellsX } = context.options.world;
  for (let z = building.z - building.depth / 2; z < building.z + building.depth / 2; z++)
    for (let x = building.x - building.width / 2; x < building.x + building.width / 2; x++)
      context.occupied[z * cellsX + x] = 1;
};
const connectDraft = (
  context: SettlementContext,
  home: SettlementBuilding,
  draft: SettlementBuilding
) => {
  const roads = context.options.roads;
  const occupied = context.occupied.slice(),
    count = context.buildings.length,
    next = context.nextBuilding;
  reservePlot(context, draft);
  if (roads.addRoad(home.access, draft.access)) return true;
  context.buildings.length = count;
  context.occupied.set(occupied);
  context.nextBuilding = next;
  context.navigationRevision = (context.navigationRevision ?? 0) + 1;
  return false;
};
const freePlotCells = (
  context: SettlementContext,
  typeId: number,
  x: number,
  z: number,
  rotation: number
) => {
  const { depth, width } = rotatedFootprint(typeId, rotation),
    { cellsX, cellsZ } = context.options.world;
  if (x + width > cellsX || z + depth > cellsZ) return false;
  for (let row = z; row < z + depth; row++)
    for (let column = x; column < x + width; column++)
      if (context.occupied[row * cellsX + column]) return false;
  return true;
};
export interface ScenarioSpaceProgress {
  stage: string;
  expansionChecks: number;
  harbourChecks: number;
  plots: number;
}
interface ScenarioSpaceOptions {
  wildlife?: ScenarioWildlifeSnapshot;
  maxMilliseconds?: number;
}
export interface ScenarioSpaceAsyncOptions extends ScenarioSpaceOptions {
  signal?: AbortSignal;
  isCurrent?: () => boolean;
  onProgress?: (progress: ScenarioSpaceProgress) => void;
  yieldControl?: () => Promise<void>;
}

/** Fixed staged spatial witness, searched on private occupancy/road graphs. No economy simulation. */
const scenarioSpaceSteps = function* (
  world: WorldData,
  options: ScenarioSpaceOptions = {}
): Generator<ScenarioSpaceProgress, ScenarioSpaceReport> {
  const started = performance.now(),
    budget = options.maxMilliseconds ?? 2000;
  if (!Number.isFinite(budget) || budget < 0 || budget > 10000)
    throw new Error("Inspection time budget must be0–10000ms");
  const deadline = started + budget,
    exhausted = () => performance.now() >= deadline;
  const report: ScenarioSpaceReport = {
    expansion: [],
    harbours: [],
    expansionChecks: 0,
    harbourChecks: 0,
    messages: [],
    stages: [],
    roads: [],
    spatialPlanProved: false,
    startupSpatialProved: false,
    authoredErrors: [],
    workspaces: [],
    candidateCount: 0,
    budgetExhausted: false,
    durationMs: 0
  };
  const progress = (stage: string): ScenarioSpaceProgress => ({
    stage,
    expansionChecks: report.expansionChecks,
    harbourChecks: report.harbourChecks,
    plots: report.expansion.length
  });
  const finish = () => {
    report.durationMs = performance.now() - started;
    report.budgetExhausted = exhausted();
    return report;
  };
  let iterations = 0,
    lastYield = performance.now();
  yield progress("Authored scenario");
  if (!world.scenario?.headquarters) {
    report.messages.push("Place an authored headquarters to inspect a staged economy layout.");
    return finish();
  }
  report.authoredErrors = validateMapScenario(world);
  if (report.authoredErrors.length) {
    report.messages.push(...report.authoredErrors.map((error) => `Authored validation: ${error}`));
    report.messages.push("Repair authored errors before a starting-space witness can be reliable.");
    return finish();
  }
  const context = createScenarioInspectionContext(world);
  context.playerNation = world.scenario.nation;
  const home = findOwnHeadquarters(context);
  if (!home) {
    report.messages.push("Headquarters placement is invalid; validate the scenario first.");
    return finish();
  }
  const roads = createScenarioRoadNetwork(context);
  roads.replaceSegments(world.scenario.roads ?? []);
  context.options.roads = roads;
  const candidates = scenarioSpaceCandidates(world, home, settlementTerritory(context).owned);
  report.candidateCount = candidates.length;
  const harbour = world.scenario.harbourPlot;
  if (harbour && !exhausted()) {
    const draft = makeBuilding(context, 39, harbour.x, harbour.z, harbour.rotation);
    if (!placementReason(context, draft) && connectDraft(context, home, draft))
      report.harbours.push(site(draft));
    else
      report.messages.push(
        "Authored harbour reservation has no proven legal placement and road approach."
      );
  }
  for (const definition of scenarioSpaceStages(world)) {
    const stage: ScenarioSpaceStage = { ...definition, found: [], unknown: [] };
    for (const typeId of stage.required) {
      let found = false,
        checks = 0;
      for (const point of orderScenarioSpaceCandidates(world, candidates, typeId)) {
        if (++iterations % 32 === 0 && performance.now() - lastYield >= 12) {
          yield progress(stage.name);
          lastYield = performance.now();
        }
        if (exhausted() || checks >= 192 || report.expansionChecks >= 6144) break;
        // All rotations use the actual size, mine/shore prerequisites, territory and road-width rules.
        for (let rotation = 0; rotation < 4; rotation++) {
          if (!freePlotCells(context, typeId, point.x, point.z, rotation)) continue;
          if (++checks > 192 || ++report.expansionChecks > 6144) break;
          const draft = legalDraft(context, typeId, point.x, point.z, rotation);
          if (!draft || !connectDraft(context, home, draft)) continue;
          report.expansion.push(site(draft));
          stage.found.push(typeId);
          found = true;
          break;
        }
        if (found) break;
      }
      if (!found) stage.unknown.push(typeId);
      yield progress(stage.name);
      lastYield = performance.now();
    }
    report.stages.push(stage);
    const unknown = stage.unknown.map((id) => getBuildingDefinition(id).name).join(", ");
    report.messages.push(
      `${stage.name}: ${stage.found.length}/${stage.required.length} simultaneous ` +
        `plots with planned roads${unknown ? `; unknown: ${unknown}` : ""}.`
    );
  }
  if (!harbour && !exhausted())
    for (const point of shoreCells(context, home)) {
      if (++iterations % 8 === 0) {
        yield progress("Harbour approaches");
        lastYield = performance.now();
      }
      if (exhausted() || report.harbourChecks >= 128 || report.harbours.length) break;
      for (let rotation = 0; rotation < 4; rotation++) {
        if (++report.harbourChecks > 128) break;
        const draft = legalDraft(context, 39, point.x, point.z, rotation);
        if (!draft || !connectDraft(context, home, draft)) continue;
        report.harbours.push(site(draft));
        break;
      }
    }
  report.roads = roads.segments();
  const planned = context.buildings.filter((building) =>
    report.expansion.some(
      (plot) => plot.typeId === building.typeId && plot.x === building.x && plot.z === building.z
    )
  );
  const workspaceInspector = createScenarioWorkspaceInspector(context, deadline, options.wildlife);
  for (const building of planned) {
    yield progress(`Work area: ${getBuildingDefinition(building.typeId).name}`);
    report.workspaces.push(...workspaceInspector.inspect(building));
  }
  report.startupSpatialProved = report.stages
    .filter((stage) => stage.mandatory)
    .every((stage) => !stage.unknown.length);
  for (const witness of report.workspaces)
    report.messages.push(
      `${getBuildingDefinition(witness.typeId).name} ${witness.kind}: ${witness.outcome.toUpperCase()}. ${witness.detail}`
    );
  report.spatialPlanProved =
    report.stages.every((stage) => !stage.unknown.length) && report.harbours.length > 0;
  report.messages.push(
    `${report.harbours.length} ocean-connected harbour plot with real ship turning rules ` +
      `and a planned road approach; ${report.expansionChecks} footprint and ${report.harbourChecks} shore checks.`
  );
  report.messages.push(
    report.spatialPlanProved
      ? "Positive spatial witness for the listed base-building plan."
      : "Incomplete spatial witness: missing plots are UNKNOWN, not proof this map cannot support them."
  );
  report.messages.push(
    report.startupSpatialProved
      ? "Required startup building/road footprints coexist; inspect separate work-area witnesses before judging production readiness."
      : "Required startup layout remains UNKNOWN; the greedy search is not an impossibility proof."
  );
  report.messages.push(
    `Inspected at most ${report.candidateCount} owned candidate origins. ` +
      "Greedy bounded search inside initial territory; no backtracking or hypothetical conquest. " +
      "Plots and proposed road edges coexist on scratch data only. Only bounded local work-area witnesses were queried; yields, mature-tree lifecycle, " +
      "staff, stock, construction order, sustained throughput and simultaneous resource contention remain unverified. " +
      "Colony construction occupations follow the selected material pair. Nothing was built or granted."
  );
  report.durationMs = performance.now() - started;
  report.budgetExhausted = exhausted();
  if (report.budgetExhausted)
    report.messages.push(
      "Inspection time budget reached; unsearched requirements remain UNKNOWN. Retry with a more open layout or inspect the individual local overlays."
    );
  return report;
};

/** Cancel between bounded search batches. Never publish a partial report from a changed map. */
export const inspectScenarioSpaceAsync = async (
  world: WorldData,
  options: ScenarioSpaceAsyncOptions = {}
) => {
  const original = {
    scenario: world.scenario,
    heights: world.heights,
    water: world.waterSurface,
    props: world.props,
    tier: world.colonyResourceTier
  };
  const revision = () =>
    `${world.buildRevision ?? 0}/${world.terrainRevision ?? 0}/${world.props?.count ?? 0}`;
  const originalRevision = revision();
  const unchanged = () =>
    originalRevision === revision() &&
    original.scenario === world.scenario &&
    original.heights === world.heights &&
    original.water === world.waterSurface &&
    original.props === world.props &&
    original.tier === world.colonyResourceTier;
  const steps = scenarioSpaceSteps(world, options);
  const yieldControl =
    options.yieldControl ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Starting-space inspection cancelled.", "AbortError");
    if (!unchanged() || (options.isCurrent && !options.isCurrent()))
      throw new DOMException(
        "Map changed or the inspection context is no longer current. " +
          "Inspect again to refresh clearance evidence.",
        "AbortError"
      );
  };
  // All graphs are scratch data; cancellation releases this generator without live-state cleanup.
  for (;;) {
    check();
    const result = steps.next();
    check();
    if (result.done) return result.value;
    options.onProgress?.(result.value);
    await yieldControl();
  }
};
