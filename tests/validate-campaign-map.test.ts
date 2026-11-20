import { describe, expect, it } from "vitest";

import type { CampaignIssue } from "../../island-of-settlers-shared/src/campaign/campaign-issues";
import { readyMap } from "../../island-of-settlers-shared/tests/campaign-fixtures";
import { DEFAULT_ISLAND_CHOICE, readIslandChoice, toWorldOptions } from "../src/app/map-generator/helpers";
import { validateCampaignMap } from "../src/shared/campaign/validate-campaign-map";
import { storedHarbourSpots } from "../src/shared/settlement/harbour-spot-index";
import { createScenarioInspectionContext } from "../src/shared/settlement/settlement-map-scenario";
import { isNavigationClear } from "../src/shared/settlement/settlement-navigation";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { createMapScenario, isMapScenario, type MapScenario, type ScenarioUnit } from "../src/shared/world/map-scenario";
import { BUILD, type HarbourSpot, type WorldData } from "../src/shared/world/world-data";
import { cachedWorldBeforeAll } from "./helpers/cached-worlds";

const OPTIONS = { imageIds: new Set(["image-intro"]) };
const SPOT: HarbourSpot = { land: { x: 20, z: 14 }, rotation: 0, water: { x: 20, z: 10 }, x: 20, z: 17, yaw: 0 };
const codes = (issues: readonly CampaignIssue[]) => issues.map(issue => issue.code);
const unit = (id: number, x: number, z: number, faction = 1): ScenarioUnit =>
  ({ faction, group: 0, heading: 0, id, rank: 0, type: "shield", x, z });

/** A flat 40² land map with one stored harbour spot: fast checks of the map-file rules. */
const flatWorld = (scenario: Partial<MapScenario>) => {
  const size = 40;
  return {
    blocking: new Uint8Array(size ** 2), buildClass: new Uint8Array(size ** 2).fill(BUILD.large), cellsX: size,
    cellsZ: size, heights: new Float32Array((size + 1) ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    oreAmount: new Uint8Array(size ** 2),
    playableIslands: { channelWidth: 0, minimumBuildingArea: { depth: 1, width: 1 }, sites: [{ harbourSpots: [SPOT] }] },
    props: { count: 0, scale: new Float32Array(), types: new Uint8Array(), x: new Float32Array(), z: new Float32Array() },
    scenario: { ...createMapScenario(), harbourPlot: { rotation: 0, x: 20, z: 17 }, kind: "campaign",
      units: [unit(1, 30, 30)], ...scenario },
    seaLevel: -1, seed: 9, start: { x: 5.5, z: 5.5 }, walkCost: new Uint8Array(size ** 2).fill(10)
  } as unknown as WorldData;
};
const fileCodes = (scenario: Partial<MapScenario>, map = readyMap({ victory: { kind: "eliminateArmy" } })) =>
  codes(validateCampaignMap(map, flatWorld(scenario), OPTIONS).errors);
const warningCodes = (scenario: Partial<MapScenario>, map: ReturnType<typeof readyMap>) =>
  codes(validateCampaignMap(map, flatWorld(scenario), OPTIONS).warnings);

describe("campaign map file rules (C7a)", () => {
  it("needs a campaign scenario without a player HQ and with the landing harbour on a harbour spot", () => {
    expect(fileCodes({ kind: "colony", landing: { x: 5, z: 5 } })).toContain("mapFileNotCampaign");
    expect(fileCodes({ headquarters: { rotation: 0, x: 8, z: 8 } })).toContain("playerHeadquartersOnCampaign");
    const missing = validateCampaignMap(readyMap({ victory: { kind: "eliminateArmy" } }),
      flatWorld({ harbourPlot: undefined }), OPTIONS).errors;
    expect(codes(missing)).toContain("landingHarbourMissing");
    expect(missing.some(issue => String(issue.params.message).includes("landing harbour"))).toBe(false);
    expect(fileCodes({ harbourPlot: { rotation: 1, x: 20, z: 17 } })).toContain("landingHarbourNotOnSpot");
    const valid = fileCodes({});
    for (const code of ["mapFileNotCampaign", "playerHeadquartersOnCampaign", "landingHarbourMissing",
      "landingHarbourNotOnSpot"]) expect(valid).not.toContain(code);
  });

  it("allows one hostile faction and no allied slot until teams exist (R6)", () => {
    const slotCodes = ["invalidHumanSlot", "alliedSlotUnsupported", "factionWithoutSlot", "multipleHostileFactions"];
    const slotErrors = (scenario: Partial<MapScenario>) =>
      fileCodes(scenario).filter(code => slotCodes.includes(code));
    expect(slotErrors({})).toEqual([]);
    expect(slotErrors({ players: [{ faction: 0, kind: "human", team: 0 },
      { faction: 1, kind: "nation", nation: "viking", team: 1 }] })).toEqual([]);
    expect(slotErrors({ units: [unit(1, 30, 30), unit(2, 31, 30, 2)] })).toEqual(["multipleHostileFactions"]);
    expect(slotErrors({ players: [{ faction: 0, kind: "human", team: 0 }, { faction: 1, kind: "bandits", team: 1 },
      { faction: 2, kind: "pirates", team: 0 }] })).toEqual(["alliedSlotUnsupported"]);
    expect(slotErrors({ players: [{ faction: 0, kind: "human", team: 0 },
      { faction: 3, kind: "bandits", team: 3 }] })).toEqual(["factionWithoutSlot", "multipleHostileFactions"]);
    expect(slotErrors({ players: [{ faction: 1, kind: "bandits", team: 1 }] })).toEqual(["invalidHumanSlot"]);
    const depotOnly = { faction: 2, mode: "maintain" as const, start: { settlers: 5, stock: { planks: 9 } } };
    expect(slotErrors({ factionAi: [depotOnly] })).toEqual(["multipleHostileFactions"]);
    expect(slotErrors({ factionAi: [depotOnly], players: [{ faction: 0, kind: "human", team: 0 },
      { faction: 1, kind: "bandits", team: 1 }] })).toEqual(["factionWithoutSlot", "multipleHostileFactions"]);
    expect(slotErrors({ factionAi: [{ faction: 2, mode: "none" }] })).toEqual([]);
  });

  it("player slots are campaign-only scenario data with a nation only for nation slots", () => {
    const scenario = (patch: Partial<MapScenario>) => ({ ...createMapScenario(), kind: "campaign", ...patch });
    const human = { faction: 0, kind: "human" as const, team: 0 };
    expect(isMapScenario(scenario({ players: [human] }), 40, 40)).toBe(true);
    expect(isMapScenario(scenario({ kind: "colony", players: [human] }), 40, 40)).toBe(false);
    expect(isMapScenario(scenario({ players: [human, { ...human, kind: "bandits", nation: "roman" }] }), 40, 40))
      .toBe(false);
    expect(isMapScenario(scenario({ players: [human, { ...human, kind: "bandits" }] }), 40, 40)).toBe(false);
  });

  it("the victory rule needs an enemy target in the map file (item 38)", () => {
    const victoryErrors = (victory: ReturnType<typeof readyMap>["victory"], units: ScenarioUnit[]) =>
      fileCodes({ units }, readyMap({ victory })).filter(code => code === "victoryTargetMissing");
    expect(victoryErrors({ kind: "eliminateArmy" }, [])).toEqual(["victoryTargetMissing"]);
    expect(victoryErrors({ kind: "totalVictory" }, [])).toEqual(["victoryTargetMissing"]);
    expect(victoryErrors({ kind: "destroyHeadquarters" }, [unit(1, 30, 30)])).toEqual(["victoryTargetMissing"]);
    expect(victoryErrors({ kind: "eliminateArmy" }, [unit(1, 30, 30)])).toEqual([]);
    expect(victoryErrors({ kind: "surviveTime", seconds: 600 }, [])).toEqual([]);
  });

  it("warns when the shipped troops are under half the enemy force, and about overridden map-file rules", () => {
    const enemies = Array.from({ length: 14 }, (_, index) => unit(index + 1, 25 + index % 7, 28 + index / 7 | 0));
    const shipped = (amount: number) => readyMap({ requiredCargo: { goods: [], settlers: 0,
      soldiers: [{ amount, type: "shield" }] }, victory: { kind: "eliminateArmy" } });
    expect(warningCodes({ units: enemies }, shipped(6))).toContain("troopPointsLow");
    expect(warningCodes({ units: enemies }, shipped(7))).not.toContain("troopPointsLow");
    expect(warningCodes({ commanderAllowed: true }, shipped(7))).toContain("mapFileRulesIgnored");
    expect(warningCodes({ disabledBuildings: [40] }, shipped(7))).toContain("mapFileRulesIgnored");
    expect(warningCodes({ commanderAllowed: false, disabledBuildings: [38] }, shipped(7)))
      .not.toContain("mapFileRulesIgnored");
  });
});

describe("land reachability from the landing harbour on a two-island map (R17)", () => {
  const query = "size=256&landform=archipelago&islandCount=2&harbourSpots=1";
  const world = cachedWorldBeforeAll({ ...DEFAULT_WORLD_OPTIONS,
    ...toWorldOptions(readIslandChoice(new URLSearchParams(query), DEFAULT_ISLAND_CHOICE)), seed: 1234 });

  /** A walkable point near an island's headquarters spot. */
  const groundNear = (base: WorldData, site: number) => {
    const context = createScenarioInspectionContext(base), centre = base.playableIslands!.sites[site]!.headquarters;
    for (let radius = 0; radius < 12; radius++)
      for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
        const point = { x: Math.floor(centre.x) + dx + 0.5, z: Math.floor(centre.z) + dz + 0.5 };
        if (isNavigationClear(context, point)) return point;
      }
    throw new Error("no walkable ground near the island centre");
  };
  /** The first stored spot belongs to the first island (spots are stored island by island). */
  const campaignWorld = (enemyIsland: number) => {
    const base = structuredClone(world()), spot = storedHarbourSpots(base)[0]!;
    base.scenario = { ...createMapScenario(), harbourPlot: { rotation: spot.rotation, x: spot.x, z: spot.z },
      kind: "campaign" };
    const enemy = groundNear(base, enemyIsland);
    base.scenario.units = [unit(1, enemy.x, enemy.z)];
    return { enemy, world: base };
  };
  const campaignMap = (enemy: { x: number; z: number }, home: { x: number; z: number }) => readyMap({
    regions: [{ id: "region-1", name: "Gate", shape: { centerX: home.x, centerZ: home.z, kind: "circle", radius: 3 } },
      { id: "region-2", name: "Camp", shape: { facing: 0, kind: "point", x: enemy.x, z: enemy.z } }],
    nextRegionNumber: 3, victory: { kind: "eliminateArmy" }
  });

  it("accepts a map whose enemy and regions share the landing island", () => {
    const { enemy, world: map } = campaignWorld(0);
    const result = validateCampaignMap(campaignMap(enemy, groundNear(map, 0)), map, OPTIONS);
    expect(result.errors).toEqual([]);
    expect(result.ready).toBe(true);
  }, 60_000);

  it("refuses an enemy spawn and a region on another landmass", () => {
    const { enemy, world: map } = campaignWorld(1);
    const result = validateCampaignMap(campaignMap(enemy, groundNear(map, 0)), map, OPTIONS);
    expect(result.errors.map(issue => issue.params.message ?? issue.params.regionId)).toEqual([
      "region-2", "Unit 1: unreachable from landing/start"
    ]);
  }, 60_000);
});
