import { describe, expect, it } from "vitest";

import {
  isCommandName, isDevelopmentCommand, recordedCommandProblem
} from "../../island-of-settlers-shared/src/commands/command-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { NOT_A_FACTION_BUILDING, NOT_AN_ECONOMY_FACTION } from "../src/shared/settlement/settlement-faction-placement";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { hashSettlementState } from "../src/shared/settlement/settlement-state-hash";
import { economyCampaignScenario } from "./helpers/economy-factions";
import { huntingWorld } from "./helpers/hunting-world";

const AI = 2;
const HEADQUARTERS = 0;
const MONUMENT = 7;
const WOODCUTTER = 17;
const DEPOT = { typeId: HEADQUARTERS, x: 47, z: 46 };
const WOODCUTTER_PLOT = { typeId: WOODCUTTER, x: 56, z: 47 };
const START_KIT = { settlers: 4, stock: { axe: 1, hammer: 2, logs: 12, planks: 12, stone: 12 } };

/** The player's headquarters at (10, 10) on flat open land; faction 2 runs an economy when asked. */
const island = (economyFactions: readonly number[] = [AI]) => {
  const world = huntingWorld();
  world.scenario = economyCampaignScenario(economyFactions);
  const roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({
    canWorkerEnterPlot: () => true, homeBuilding: 0, initialSettlers: 8, roads, world
  });
  return { simulation, world };
};

/** The island after `aiPlace` raised the faction's stocked depot in the east. */
const islandWithDepot = () => {
  const created = island();
  const placed = created.simulation.aiPlace(AI, DEPOT, START_KIT);
  expect(placed.ok, placed.reason).toBe(true);
  return { ...created, depot: placed.building! };
};

describe("placeFactionBuilding (EAI1d)", () => {
  it("places a construction site in the faction's territory, paid from the faction's stock", () => {
    const { depot, simulation } = islandWithDepot();
    const playerStock = { ...simulation.headquarters.inventory };
    const placed = simulation.placeFactionBuilding(AI, WOODCUTTER_PLOT);
    expect(placed.ok, placed.reason).toBe(true);
    expect(placed.building).toMatchObject({ construction: 0, militaryFaction: AI, typeId: WOODCUTTER });
    expect(simulation.buildings()).toContain(placed.building);
    expect(simulation.headquarters.inventory).toEqual(playerStock);
    expect(depot.militaryFaction).toBe(AI);
  });

  it("refuses the player, a faction without an economy and a malformed draft", () => {
    const { simulation } = islandWithDepot();
    for (const faction of [0, 3, -1, 1.5, Number.NaN])
      expect(simulation.placeFactionBuilding(faction, WOODCUTTER_PLOT))
        .toEqual({ ok: false, reason: NOT_AN_ECONOMY_FACTION });
    expect(island([]).simulation.placeFactionBuilding(AI, WOODCUTTER_PLOT).reason).toBe(NOT_AN_ECONOMY_FACTION);
    expect(simulation.placeFactionBuilding(AI, { ...WOODCUTTER_PLOT, x: Number.NaN }).reason)
      .toBe("Choose a valid plot");
    expect(simulation.placeFactionBuilding(AI, { ...WOODCUTTER_PLOT, typeId: 9999 }).reason)
      .toBe("Choose a buildable building");
    expect(simulation.placeFactionBuilding(AI, { ...DEPOT, x: 56 }).reason).toBe("Choose a buildable building");
  });

  it("refuses an invalid plot with the player's reasons: occupied, outside its territory, unpaid", () => {
    const { simulation } = islandWithDepot();
    const count = simulation.buildings().length;
    expect(simulation.placeFactionBuilding(AI, { ...WOODCUTTER_PLOT, x: DEPOT.x, z: DEPOT.z }).ok).toBe(false);
    expect(simulation.placeFactionBuilding(AI, { ...WOODCUTTER_PLOT, x: 4, z: 4 }).reason)
      .toBe("Build inside your territory; station soldiers to expand it");
    const poor = island();
    expect(poor.simulation.aiPlace(AI, DEPOT, {}).ok).toBe(true);
    expect(poor.simulation.placeFactionBuilding(AI, WOODCUTTER_PLOT).ok).toBe(false);
    expect(simulation.buildings()).toHaveLength(count);
  });

  it("counts build limits per owner", () => {
    const { simulation } = islandWithDepot();
    const first = simulation.aiPlace(AI, { typeId: MONUMENT, x: 56.5, z: 39.5 }, {});
    expect(first.ok, first.reason).toBe(true);
    expect(simulation.placeFactionBuilding(AI, { typeId: MONUMENT, x: 40.5, z: 52.5 }).reason).toMatch(/^Only one /);
    expect(simulation.singleBuildingBuilt(MONUMENT)).toBe(false);
  });

  it("is deterministic: the same calls give the same island state", () => {
    const run = () => {
      const { simulation, world } = islandWithDepot();
      simulation.placeFactionBuilding(AI, WOODCUTTER_PLOT);
      for (let tick = 0; tick < 400; tick++) simulation.update(0.05);
      return hashSettlementState({ settlement: simulation.saveState(), world });
    };
    expect(run()).toBe(run());
  });

  // A kit's settlers reload once EAI1c counts the saved settler total per economy (its step c6).
  it("survives a save and reload with its owner and its site", () => {
    const { simulation } = island();
    expect(simulation.aiPlace(AI, DEPOT, { stock: START_KIT.stock }).ok).toBe(true);
    expect(simulation.placeFactionBuilding(AI, WOODCUTTER_PLOT).ok).toBe(true);
    for (let tick = 0; tick < 40; tick++) simulation.update(0.05);
    const saved = simulation.saveState();
    const reloaded = island().simulation;
    const loaded = reloaded.loadState(structuredClone(saved));
    expect(loaded.ok, JSON.stringify(loaded)).toBe(true);
    expect(reloaded.buildings().filter(building => building.militaryFaction === AI).map(building => building.typeId))
      .toEqual([HEADQUARTERS, WOODCUTTER]);
  });
});

describe("connectFactionRoads (EAI1d)", () => {
  it("links the faction's buildings inside its territory and refuses the player", () => {
    const { depot, simulation } = islandWithDepot();
    const site = simulation.placeFactionBuilding(AI, WOODCUTTER_PLOT).building!;
    expect(simulation.connectFactionRoads(0, depot.access, site.access)).toBe(false);
    expect(simulation.connectFactionRoads(AI, depot.access, site.access)).toBeTruthy();
    expect(simulation.connectFactionRoads(AI, depot.access, { x: 4, z: 4 })).toBeFalsy();
  });
});

describe("demolishFactionBuilding (EAI1d, EAI1a E8/A27)", () => {
  it("lets only the owner faction demolish its site and keeps the faction's home", () => {
    const { depot, simulation } = islandWithDepot();
    const site = simulation.placeFactionBuilding(AI, WOODCUTTER_PLOT).building!;
    expect(simulation.demolishBuilding(site.uid).ok).toBe(false);
    expect(simulation.demolishFactionBuilding(AI, simulation.headquarters.uid).reason).toBe(NOT_A_FACTION_BUILDING);
    expect(simulation.demolishFactionBuilding(3, site.uid).reason).toBe(NOT_AN_ECONOMY_FACTION);
    expect(simulation.demolishFactionBuilding(AI, depot.uid).ok).toBe(false);
    expect(simulation.demolishFactionBuilding(AI, site.uid).ok).toBe(true);
    expect(simulation.buildings()).not.toContain(site);
  });
});

describe("aiPlace (EAI1d development command)", () => {
  it("raises a finished, stocked depot as the faction's first building", () => {
    const { depot } = islandWithDepot();
    expect(depot).toMatchObject({ construction: 1, idleSettlers: 4, militaryFaction: AI, typeId: HEADQUARTERS });
    expect(depot.inventory).toMatchObject(START_KIT.stock);
  });

  it("refuses a second headquarters and a start kit outside a storage", () => {
    const { simulation } = islandWithDepot();
    expect(simulation.aiPlace(AI, { ...DEPOT, x: 56 }, {}).reason).toBe("Choose a buildable building");
    expect(simulation.aiPlace(AI, WOODCUTTER_PLOT, { settlers: 2 }).ok).toBe(false);
    expect(simulation.aiPlace(AI, DEPOT, { settlers: -1 }).ok).toBe(false);
  });

  it("is a development command; the faction entries are not commands at all", () => {
    const command = { args: [AI, DEPOT, START_KIT], name: "aiPlace" };
    expect(isDevelopmentCommand("aiPlace")).toBe(true);
    expect(recordedCommandProblem(command, true)).toBeNull();
    expect(recordedCommandProblem(command, false)).toBe("Rejected command aiPlace");
    expect(recordedCommandProblem({ args: [0, DEPOT], name: "aiPlace" }, true)).toBe("Invalid faction building");
    expect(recordedCommandProblem({ args: [AI, { typeId: 17 }], name: "aiPlace" }, true))
      .toBe("Invalid faction building");
    for (const name of ["connectFactionRoads", "demolishFactionBuilding", "placeFactionBuilding"])
      expect(isCommandName(name)).toBe(false);
  });
});
