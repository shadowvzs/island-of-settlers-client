import { describe, expect, it } from "vitest";

import { DEVELOP_LEVEL_SCALING } from "../src/shared/balance/enemy-scaling";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { isMapScenario, type MapScenario, type ScenarioBuilding } from "../src/shared/world/map-scenario";
import type { FactionAiMode, ScenarioFactionAiStart } from "../src/shared/world/scenario-faction-ai";
import { startTroopTotal } from "../src/shared/world/scenario-start-troops";
import { economyCampaignScenario } from "./helpers/economy-factions";
import { huntingWorld } from "./helpers/hunting-world";

/** EAI-CLOSE: a map's `factionAi[].start` enters the faction's authored depot (an enemy HQ) at a new game. */
const AI = 2;
const MAP_SIZE = 96;
const START: ScenarioFactionAiStart = { settlers: 6, stock: { logs: 9, planks: 14 } };
const DEPOT: ScenarioBuilding = { defenders: 0, faction: AI, id: 1, rotation: 0, type: 0, x: 47, z: 46 };

const scenarioWith = (mode: FactionAiMode, start: ScenarioFactionAiStart | undefined,
  buildings: ScenarioBuilding[] = [DEPOT]): MapScenario => {
  const scenario = economyCampaignScenario([AI], mode);
  scenario.factionAi = scenario.factionAi!.map(entry => start ? { ...entry, start } : entry);
  return { ...scenario, buildings };
};

const islandOf = (scenario: MapScenario) => {
  const world = huntingWorld(MAP_SIZE);
  world.scenario = scenario;
  const simulation = createSettlementSimulation({
    canWorkerEnterPlot: () => true, homeBuilding: 0, initialSettlers: 8, roads: createRoadNetwork(world), world
  });
  const depot = simulation.buildings().find(building => building.militaryFaction === AI)!;
  const soldiers = simulation.militarySoldiers().filter(soldier => soldier.combat?.faction === AI).length;
  return { depot, simulation, soldiers };
};

describe("map faction AI start (EAI-CLOSE)", () => {
  it("lets only a playing AI faction author its depot: an enemy headquarters without defenders", () => {
    const valid = (scenario: MapScenario) => isMapScenario(scenario, MAP_SIZE, MAP_SIZE);
    expect(valid(scenarioWith("develop", START))).toBe(true);
    expect(valid(scenarioWith("maintain", START))).toBe(true);
    expect(valid(scenarioWith("none", START))).toBe(false);
    expect(valid(scenarioWith("develop", START, [{ ...DEPOT, faction: 3 }]))).toBe(false);
    expect(valid(scenarioWith("develop", START, [{ ...DEPOT, defenders: 1 }]))).toBe(false);
  });

  it("fills the authored depot with the start settlers, wares and the develop level's soldiers", () => {
    const { depot, soldiers } = islandOf(scenarioWith("develop", START));
    expect(depot.typeId).toBe(0);
    expect(depot.idleSettlers).toBe(START.settlers);
    expect(depot.inventory).toMatchObject(START.stock);
    expect(soldiers).toBe(startTroopTotal(DEVELOP_LEVEL_SCALING.medium.startSoldiers));
  });

  it("keeps the start's own soldier list, and gives a maintain faction only what it names", () => {
    const soldiers = [{ count: 3, rank: 1, type: "archer" as const }];
    expect(islandOf(scenarioWith("develop", { ...START, soldiers })).soldiers).toBe(3);
    const maintain = islandOf(scenarioWith("maintain", START));
    expect(maintain.depot.idleSettlers).toBe(START.settlers);
    expect(maintain.soldiers).toBe(0);
  });

  it("leaves a depot without a start, and the same map reloaded, untouched", () => {
    const empty = islandOf(scenarioWith("develop", undefined));
    expect(empty.depot.idleSettlers ?? 0).toBe(0);
    expect(empty.soldiers).toBe(0);
    const { simulation } = islandOf(scenarioWith("develop", START));
    const saved = simulation.saveState();
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    expect(simulation.buildings().find(building => building.militaryFaction === AI)!.idleSettlers)
      .toBe(START.settlers);
  });
});
