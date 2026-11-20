import { describe, expect, it } from "vitest";

import { BuildingType } from "../../island-of-settlers-shared/src/building-types";
import { MONUMENT_TYPE_ID } from "../src/render-common/buildings/monument-definition";
import { resolveIslandRole } from "../src/shared/settlement/island-role";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { NOT_ON_THIS_MAP } from "../src/shared/settlement/settlement-simulation-placement";
import { createMapScenario, isMapScenario, type MapScenario } from "../src/shared/world/map-scenario";
import { huntingWorld } from "./helpers/hunting-world";

const WOODCUTTER = BuildingType.Woodcutter;
const LODGE = BuildingType.CommandersLodge;
const CATAPULT = BuildingType.Catapult;

const island = (scenario?: Partial<MapScenario>) => {
  const world = huntingWorld();
  if (scenario) world.scenario = { ...createMapScenario(), ...scenario };
  return createSettlementSimulation({ world, roads: createRoadNetwork(world), initialSettlers: 8, homeBuilding: 0,
    initialStock: {}, unlockAllBuildings: true, canWorkerEnterPlot: () => true });
};

describe("islandRole", () => {
  it("checks the authored kind first and the live colony/adventure state only when needed", () => {
    const never = () => { throw new Error("not read"); };
    expect(resolveIslandRole("campaign", never, never)).toBe("campaign");
    expect(resolveIslandRole("colony", never, never)).toBe("colony");
    expect(resolveIslandRole("home", () => true, never)).toBe("colony");
    expect(resolveIslandRole(undefined, () => false, () => true)).toBe("adventure");
    expect(resolveIslandRole("home", () => false, () => false)).toBe("home");
    expect(island().islandRole()).toBe("home");
    expect(island({ kind: "campaign" }).islandRole()).toBe("campaign");
  });
});

describe("campaign building gates", () => {
  it("refuses a blacklisted type in placeBuilding, validatePlacement and the menu (hidden)", () => {
    const simulation = island({ kind: "campaign", disabledBuildings: [WOODCUTTER] });
    expect(simulation.placeBuilding(WOODCUTTER, 20, 20)).toEqual({ ok: false, reason: NOT_ON_THIS_MAP });
    expect(simulation.validatePlacement(WOODCUTTER, 20, 20)).toBe(NOT_ON_THIS_MAP);
    expect(simulation.offersBuilding(WOODCUTTER)).toBe(false);
    expect(simulation.allowsBuilding(WOODCUTTER)).toBe(false);
    expect(island({ kind: "campaign" }).offersBuilding(WOODCUTTER)).toBe(true);
  });

  it("allows the Lodge at home and on a campaign map only with commanderAllowed (R11)", () => {
    expect(island().offersBuilding(LODGE)).toBe(true);
    expect(island({ kind: "campaign" }).offersBuilding(LODGE)).toBe(false);
    expect(island({ kind: "campaign", commanderAllowed: true }).offersBuilding(LODGE)).toBe(true);
    expect(island({ kind: "colony" }).offersBuilding(LODGE)).toBe(false);
    expect(island({ kind: "adventure" }).offersBuilding(LODGE)).toBe(false);
  });

  it("keeps the Monument home-only, also on a campaign map that allows the commander", () => {
    expect(island().offersBuilding(MONUMENT_TYPE_ID)).toBe(true);
    const campaign = island({ kind: "campaign", commanderAllowed: true });
    expect(campaign.offersBuilding(MONUMENT_TYPE_ID)).toBe(false);
    expect(campaign.validatePlacement(MONUMENT_TYPE_ID, 20, 20)).toMatch(/only be built on the home island/);
  });

  it("counts only the player's own buildings against a build limit (R13)", () => {
    const simulation = island();
    const sites = [[12.5, 40.5], [24.5, 40.5], [36.5, 40.5]]
      .map(([x, z]) => simulation.placeMilitaryScenarioBuilding(CATAPULT, x!, z!));
    expect(sites.map(site => site.ok || site.reason)).toEqual([true, true, true]);
    expect(simulation.offersBuilding(CATAPULT)).toBe(true);
    for (const site of sites) if (site.ok) site.building.militaryFaction = 0;
    expect(simulation.offersBuilding(CATAPULT)).toBe(false);
  });
});

describe("campaign scenario fields", () => {
  const valid = (scenario: Partial<MapScenario>) => isMapScenario({ ...createMapScenario(), ...scenario }, 64, 64);
  it("accepts them only on a campaign map, as unique ascending ids that are never HQ, Harbour or Storehouse", () => {
    expect(valid({ kind: "campaign", commanderAllowed: true, disabledBuildings: [WOODCUTTER, LODGE].sort((a, b) =>
      a - b) })).toBe(true);
    expect(valid({ kind: "home", disabledBuildings: [WOODCUTTER] })).toBe(false);
    expect(valid({ kind: "colony", commanderAllowed: false })).toBe(false);
    expect(valid({ kind: "campaign", disabledBuildings: [WOODCUTTER, WOODCUTTER] })).toBe(false);
    expect(valid({ kind: "campaign", disabledBuildings: [BuildingType.Harbour] })).toBe(false);
    expect(valid({ kind: "campaign", disabledBuildings: [BuildingType.Storehouse] })).toBe(false);
    expect(valid({ kind: "campaign", disabledBuildings: [0] })).toBe(false);
    expect(valid({ kind: "campaign", disabledBuildings: [99999] })).toBe(false);
  });
});
