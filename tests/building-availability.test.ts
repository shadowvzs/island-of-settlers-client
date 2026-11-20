import { describe, expect, it } from "vitest";

import { BuildingType } from "../../island-of-settlers-shared/src/building-types";
import {
  buildingLevelLimit, isBuildingAvailability, isWareAllowedByTier, narrowBuildingAvailability, wareResourceTier
} from "../../island-of-settlers-shared/src/game-settings/building-availability";
import {
  applyAvailability, withBanToggled, withTier
} from "../src/app/map-editor/building-availability/helpers";
import { getBuildingCardGroups, selectBuildingPicker } from "../src/app/settlement-ui/main-panel/build-helpers";
import { aiBuildingTier } from "../src/shared/balance/enemy-scaling";
import { generateDailyQuests } from "../src/shared/progression/daily-quests";
import { campaignRunWorld } from "../src/shared/campaign/campaign-start";
import { NOT_ON_THIS_MAP } from "../src/shared/settlement/building-availability-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { generateMerchantMarket } from "../src/shared/trade/merchant-offers";
import { availabilityChainIssues, availabilityMaterialIssues } from "../src/shared/world/availability-checks";
import { createMapScenario, isMapScenario, type MapScenario } from "../src/shared/world/map-scenario";
import { economyCampaignScenario } from "./helpers/economy-factions";
import { huntingWorld } from "./helpers/hunting-world";
import { workshopUpgradeFixture } from "./helpers/workshop-upgrade-fixture";

const WOODCUTTER = BuildingType.Woodcutter;
const UPGRADE_STOCK = { hardwoodLogs: 4, hardwoodPlanks: 4, marble: 2 };

const island = (scenario?: Partial<MapScenario>) => {
  const world = huntingWorld();
  if (scenario) world.scenario = { ...createMapScenario(), ...scenario };
  return createSettlementSimulation({ world, roads: createRoadNetwork(world), initialSettlers: 8, homeBuilding: 0,
    initialStock: {}, unlockAllBuildings: true, canWorkerEnterPlot: () => true });
};

describe("building availability model", () => {
  it("validates the stored shape", () => {
    expect(isBuildingAvailability({})).toBe(true);
    expect(isBuildingAvailability({ banned: [3, 7], levelCaps: [{ level: 2, type: 4 }], tier: 3 })).toBe(true);
    expect(isBuildingAvailability({ tier: 6 })).toBe(false);
    expect(isBuildingAvailability({ banned: [7, 3] })).toBe(false);
    expect(isBuildingAvailability({ other: 1 })).toBe(false);
  });

  it("caps levels by tier and per type, and wares by material tier", () => {
    expect(buildingLevelLimit(undefined, 4)).toBe(5);
    expect(buildingLevelLimit({ tier: 3 }, 4)).toBe(3);
    expect(buildingLevelLimit({ levelCaps: [{ level: 2, type: 4 }], tier: 3 }, 4)).toBe(2);
    expect(isWareAllowedByTier({ tier: 1 }, "planks")).toBe(true);
    expect(isWareAllowedByTier({ tier: 1 }, "marble")).toBe(false);
    expect(isWareAllowedByTier({ tier: 2 }, "hardwoodPlanks")).toBe(true);
    expect(isWareAllowedByTier({ tier: 4 }, "granite")).toBe(false);
    expect(isWareAllowedByTier({ tier: 1 }, "bread")).toBe(true);
  });

  it("narrows two layers into the union of bans and the lower caps", () => {
    expect(narrowBuildingAvailability({ banned: [5], tier: 4 }, { banned: [2], levelCaps: [{ level: 3, type: 9 }],
      tier: 5 })).toEqual({ banned: [2, 5], levelCaps: [{ level: 3, type: 9 }], tier: 4 });
  });

  it("is accepted on every map kind with catalog ids, never banning HQ, Harbour or Storehouse", () => {
    const valid = (scenario: Partial<MapScenario>) =>
      isMapScenario({ ...createMapScenario(), ...scenario }, 64, 64);
    for (const kind of ["home", "colony", "adventure", "campaign"] as const)
      expect(valid({ availability: { banned: [WOODCUTTER], tier: 2 }, kind })).toBe(true);
    expect(valid({ availability: { banned: [BuildingType.Harbour] } })).toBe(false);
    expect(valid({ availability: { banned: [99999] } })).toBe(false);
  });
});

describe("building availability in the simulation", () => {
  it("bans a type on a home map: refused and hidden from the menu", () => {
    const simulation = island({ availability: { banned: [WOODCUTTER] } });
    expect(simulation.placeBuilding(WOODCUTTER, 20, 20)).toEqual({ ok: false, reason: NOT_ON_THIS_MAP });
    expect(simulation.offersBuilding(WOODCUTTER)).toBe(false);
    expect(island().offersBuilding(WOODCUTTER)).toBe(true);
  });

  it("merges a campaign blacklist with the map's own bans", () => {
    const simulation = island({ availability: { banned: [BuildingType.Fishery] }, disabledBuildings: [WOODCUTTER],
      kind: "campaign" });
    expect(simulation.buildingAvailability()?.banned).toEqual([WOODCUTTER, BuildingType.Fishery].sort((a, b) =>
      a - b));
  });

  it("reports the tier a material producer needs above the cap", () => {
    expect(island({ availability: { tier: 1 } }).buildingTierBlock(42)).toBe(2);
    expect(island({ availability: { tier: 2 } }).buildingTierBlock(42)).toBeNull();
    expect(island({ availability: { tier: 4 } }).buildingTierBlock(54)).toBe(5);
    expect(island({ availability: { tier: 1 } }).buildingTierBlock(WOODCUTTER)).toBeNull();
  });

  it("blocks new upgrades above the tier; existing levels stay", () => {
    const { building, simulation } = workshopUpgradeFixture(33, UPGRADE_STOCK);
    expect(simulation.setHomeBuildingRules({ tier: 1 })).toBe(true);
    expect(simulation.workshopUpgradeAvailability(building.uid)).toMatchObject({
      available: false, reason: "This map allows building level 1 at most." });
    expect(simulation.requestWorkshopUpgrade(building.uid)).toBe(false);
    expect(simulation.setHomeBuildingRules({})).toBe(true);
    expect(simulation.homeBuildingRules()).toBeUndefined();
    expect(simulation.workshopUpgradeAvailability(building.uid)?.available).toBe(true);
  });

  it("saves and restores the home rules; the command is home-only", () => {
    const simulation = island();
    expect(simulation.setHomeBuildingRules({ banned: [WOODCUTTER], unlockAll: true })).toBe(true);
    expect(simulation.setHomeBuildingRules({ tier: 9 })).toBe("Invalid building rules");
    const saved = simulation.saveState();
    expect(saved.homeBuildingRules).toEqual({ banned: [WOODCUTTER], unlockAll: true });
    const restored = island();
    expect(restored.loadState(saved).ok).toBe(true);
    expect(restored.offersBuilding(WOODCUTTER)).toBe(false);
    expect(island({ kind: "colony" }).setHomeBuildingRules({ tier: 2 })).toMatch(/home island/);
  });

  it("puts a campaign record's level caps over the map file's availability", () => {
    const world = huntingWorld();
    world.scenario = { ...createMapScenario(), availability: { tier: 4 }, harbourPlot: { rotation: 0, x: 5, z: 5 },
      kind: "campaign" };
    const run = campaignRunWorld(world, { commanderAllowed: false, disabledBuildings: [
      { buildingType: 33, maxLevel: 2 }, { buildingType: WOODCUTTER, maxLevel: null }], lodgeAllowed: false });
    expect(run.scenario?.availability).toEqual({ levelCaps: [{ level: 2, type: 33 }], tier: 4 });
  });
});

describe("build menu", () => {
  it("greys a tier-blocked card with the tier badge and the reason", () => {
    const picker = selectBuildingPicker({ buildableTypes: [42, WOODCUTTER], buildingTierCap: 1, resources: {},
      tierBlockedBuildings: "42:2" });
    const cards = getBuildingCardGroups(picker).flatMap(group => group.cards);
    expect(cards.find(card => card.id === 42)).toMatchObject({ hidden: false, lockText: "Tier 2", locked: true });
    expect(cards.find(card => card.id === 42)?.title).toContain("this map allows tier 1 at most");
    expect(cards.find(card => card.id === WOODCUTTER)).toMatchObject({ locked: false });
  });
});

describe("map save validation", () => {
  it("reports the chain a banned Sawmill breaks and tiers without a material source", () => {
    const [planks] = availabilityChainIssues({ nation: "roman", rules: { banned: [BuildingType.Sawmill] } });
    expect(planks).toMatchObject({ banned: [BuildingType.Sawmill], kind: "chain", severity: "error",
      ware: "planks" });
    expect(availabilityChainIssues({ nation: "roman", rules: { banned: [WOODCUTTER] } })[0]).toMatchObject({
      severity: "warning", ware: "logs" });
    expect(availabilityChainIssues({ nation: "roman", rules: { tier: 2 } })).toEqual([]);
    const missing = availabilityMaterialIssues({ deposits: [{ id: 0, material: "limestone", remaining: 5, x: 1, z: 1 }], propTypes: [], rules: { tier: 3 } });
    expect(missing).toEqual([{ kind: "noMaterialSource", severity: "warning", stone: "marble", tier: 2,
      wood: "hardwood" }]);
  });

  it("edits the scenario's tier and bans through the editor helpers", () => {
    const scenario = createMapScenario();
    applyAvailability(scenario, withBanToggled(withTier({}, 3), WOODCUTTER));
    expect(scenario.availability).toEqual({ banned: [WOODCUTTER], tier: 3 });
    applyAvailability(scenario, withTier(withBanToggled(scenario.availability!, WOODCUTTER), 5));
    expect(scenario.availability).toBeUndefined();
  });
});

describe("quest and market pools", () => {
  const advanced = (ware: string) => (wareResourceTier(ware) ?? 0) > 0;
  it("leave out materials above the tier cap", () => {
    const days = Array.from({ length: 60 }, (_, index) => `2026-01-${String(index % 28 + 1).padStart(2, "0")}-${index}`);
    const capped = days.flatMap(day => generateDailyQuests(day, 30, 7, new Set(), "roman",
      { reliefAvailable: false, tierCap: 1 }));
    expect(capped.some(quest => advanced(quest.ware))).toBe(false);
    const free = days.flatMap(day => generateDailyQuests(day, 30, 7, new Set(), "roman", { reliefAvailable: false }));
    expect(free.some(quest => advanced(quest.ware))).toBe(true);
    const offers = Array.from({ length: 30 }, (_, day) => generateMerchantMarket(5, day, 30, "roman", 1).offers)
      .flat();
    expect(offers.some(offer => advanced(offer.give.ware) || advanced(offer.want.ware))).toBe(false);
  });
});

describe("computer factions", () => {
  it("follow the map's bans, never the player's level", () => {
    const world = huntingWorld();
    world.scenario = { ...economyCampaignScenario([2]), availability: { banned: [WOODCUTTER] } };
    const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world), initialSettlers: 8,
      homeBuilding: 0, canWorkerEnterPlot: () => true });
    const depot = simulation.aiPlace(2, { typeId: 0, x: 47, z: 46 }, { settlers: 4,
      stock: { axe: 1, hammer: 2, logs: 12, planks: 12, stone: 12 } });
    expect(depot.ok, depot.reason).toBe(true);
    expect(simulation.aiPlace(2, { typeId: WOODCUTTER, x: 52, z: 46 })).toMatchObject({
      ok: false, reason: NOT_ON_THIS_MAP });
  });

  const tierIsland = (level: "easy" | "medium") => {
    const world = huntingWorld();
    world.colonyResourceTier = 1;
    const scenario = economyCampaignScenario([2], "maintain", "colony");
    world.scenario = { ...scenario, availability: { tier: 2 },
      factionAi: scenario.factionAi!.map(entry => ({ ...entry, level })) };
    const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world), initialSettlers: 8,
      homeBuilding: 0, canWorkerEnterPlot: () => true });
    simulation.aiPlace(2, { typeId: 0, x: 47, z: 46 }, { settlers: 4,
      stock: { axe: 1, hammer: 2, logs: 12, planks: 12, stone: 12 } });
    return simulation;
  };

  it("play one tier lower on Easy, never below tier 1; other levels keep the map tier", () => {
    expect(aiBuildingTier(5, "easy")).toBe(4);
    expect(aiBuildingTier(1, "easy")).toBe(1);
    for (const pace of ["medium", "hard", "veryHard"] as const) expect(aiBuildingTier(3, pace)).toBe(3);
    const hardwood = 41;
    expect(tierIsland("easy").aiPlace(2, { typeId: hardwood, x: 52, z: 46 })).toMatchObject({
      ok: false, reason: "Needs material tier 2; this map allows tier 1 at most" });
    expect(tierIsland("medium").aiPlace(2, { typeId: hardwood, x: 52, z: 46 }).reason ?? "")
      .not.toMatch(/material tier/);
  });
});
