import { expect } from "vitest";

import type { OfflineReplayOptions } from "../../src/app/settlement/offline-progress";
import { createGameSave, type GameSaveV1 } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { FactionAiMode } from "../../src/shared/world/scenario-faction-ai";
import { PROP } from "../../src/shared/world/world-data";
import { economyCampaignScenario } from "./economy-factions";
import { huntingWorld } from "./hunting-world";

export const AI_FACTION = 2;
const HEADQUARTERS = 0;
export const WOODCUTTER = 17;
const START = 10_000_000;
const TREES: readonly (readonly [number, number])[] = [[53, 40], [56, 39], [59, 40], [62, 41], [57, 42]];

/** Every offline catch-up mode (EAI5b gate): the exact lane, event core, both skips and the fast economy. */
export const CATCH_UP_MODES: readonly [string, OfflineReplayOptions][] = [
  ["exact", { exact: true, eventCore: false }],
  ["event core", { exact: true, eventCore: "auto" }],
  ["quiet skip", { exact: true, quietSkip: true }],
  ["movement skip", { exact: true, movementSkip: true }],
  ["fast economy", { economy: true, economyCalibrationSeconds: 0 }]
];

/**
 * An empty authored campaign map whose faction 2 runs a `maintain` economy: the player's HQ at the population cap and
 * the AI's HQ with a start kit; `woodcutter` adds an AI woodcutter on a road to its depot, worked for a minute
 * before the save. The authored-scenario progress is left out of the save, so the quiet skip's own guards decide (an
 * authored map keeps exact ticks through its `scenario` guard).
 */
export const aiIslandSave = async (woodcutter: boolean, mode: FactionAiMode = "maintain"): Promise<GameSaveV1> => {
  const world = huntingWorld();
  world.props.count = TREES.length;
  world.props.types.fill(PROP.coniferTree, 0, TREES.length);
  TREES.forEach(([x, z], index) => { world.props.x[index] = x; world.props.z[index] = z; });
  world.props.scale.fill(1);
  world.scenario = { ...economyCampaignScenario([AI_FACTION], mode), headquarters: { rotation: 0, x: 12, z: 12 } };
  const roads = createRoadNetwork(world, { isBlocked: () => false });
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: 100,
    canWorkerEnterPlot: () => true });
  const depot = simulation.aiPlace(AI_FACTION, { typeId: HEADQUARTERS, x: 47, z: 46 },
    { settlers: 3, stock: { axe: 1, logs: 4, planks: 8, stone: 8 } });
  expect(depot.ok, depot.reason).toBe(true);
  if (woodcutter) {
    const placed = simulation.placeFactionBuilding(AI_FACTION, { typeId: WOODCUTTER, x: 56, z: 47 });
    expect(placed.ok, placed.reason).toBe(true);
    Object.assign(placed.building!, { construction: 1, foundationProgress: 1, required: {} });
    expect(simulation.connectFactionRoads(AI_FACTION, depot.building!.access, placed.building!.access)).toBeTruthy();
    for (let step = 0; step < 20 * 60; step++) simulation.update(.05);
  } else simulation.update(.05);
  const { authoredScenario: _authored, ...settlement } = simulation.saveState();
  return createGameSave(world, settlement, {
    name: "AI island", savedAt: START, source: "generated", animals: [] });
};
