import { starterStockForNation } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { campaignStartOptions } from "../src/shared/campaign/campaign-start";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { validateMapScenario } from "../src/shared/settlement/settlement-map-scenario";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { createMapScenario, isMapScenario, type MapScenario } from "../src/shared/world/map-scenario";
import { hasAuthoredStock, scenarioStartStock } from "../src/shared/world/scenario-start-stock";
import { startTroopRecruits, validScenarioStartTroops } from "../src/shared/world/scenario-start-troops";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const SIZE = 40;
const worldFixture = (scenario?: MapScenario) => ({
  seed: 9, cellsX: SIZE, cellsZ: SIZE, seaLevel: -1, start: { x: 5.5, z: 5.5 },
  heights: new Float32Array((SIZE + 1) ** 2), blocking: new Uint8Array(SIZE ** 2),
  walkCost: new Uint8Array(SIZE ** 2).fill(10), buildClass: new Uint8Array(SIZE ** 2).fill(BUILD.large),
  oreAmount: new Uint8Array(SIZE ** 2), mineZone: new Uint16Array(SIZE ** 2), mineZones: [], scenario,
  props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
}) as unknown as WorldData;
const homeScenario = (change: Partial<MapScenario> = {}): MapScenario =>
  ({ ...createMapScenario(), headquarters: { rotation: 0, x: 10, z: 10 }, ...change });
const simulate = (world: WorldData, options: Partial<Parameters<typeof createSettlementSimulation>[0]> = {}) =>
  createSettlementSimulation({ roads: createRoadNetwork(world), world, ...options });

describe("map start stock", () => {
  it("treats an empty or all-zero stock as the nation default (Indigenous keeps its 48 cloth)", () => {
    expect(hasAuthoredStock({})).toBe(false);
    expect(hasAuthoredStock({ planks: 0 })).toBe(false);
    expect(hasAuthoredStock({ planks: 3 })).toBe(true);
    expect(scenarioStartStock({}, "indigenous")).toEqual(starterStockForNation("indigenous"));
    expect(scenarioStartStock({}, "indigenous").cloth).toBe(48);
    expect(scenarioStartStock({ planks: 0 }, "roman")).toEqual(starterStockForNation("roman"));
    const authored = { planks: 5 };
    expect(scenarioStartStock(authored, "indigenous")).toEqual({ planks: 5 });
    expect(scenarioStartStock(authored, "indigenous")).not.toBe(authored);
  });

  it("fills the HQ of an empty-stock map with the nation default and keeps authored stock exact", () => {
    const fallback = simulate(worldFixture(homeScenario({ nation: "indigenous", stock: {} })));
    expect(fallback.headquarters.inventory).toEqual(starterStockForNation("indigenous"));
    const authored = simulate(worldFixture(homeScenario({ nation: "indigenous", stock: { planks: 17 } })));
    expect(authored.headquarters.inventory).toEqual({ planks: 17 });
    const caller = simulate(worldFixture(homeScenario({ stock: {} })), { initialStock: {} });
    expect(caller.headquarters.inventory).toEqual({});
  });
});

describe("map start soldiers", () => {
  it("accepts ordinary lines within the limits only", () => {
    expect(validScenarioStartTroops(undefined)).toBe(true);
    expect(validScenarioStartTroops([{ count: 4, rank: 1, type: "archer" }])).toBe(true);
    expect(validScenarioStartTroops([{ count: 1, rank: 0, type: "cavalry" }])).toBe(false);
    expect(validScenarioStartTroops([{ count: 1, rank: 3, type: "shield" }])).toBe(false);
    expect(validScenarioStartTroops([{ count: 0, rank: 0, type: "shield" }])).toBe(false);
    expect(validScenarioStartTroops([{ count: 150, rank: 0, type: "shield" },
      { count: 51, rank: 0, type: "heavy" }])).toBe(false);
    expect(startTroopRecruits([{ count: 2, rank: 1, type: "heavy" }]).map(troop => troop.rank)).toEqual([1, 1]);
  });

  it("stations the start soldiers in the home reserve on a map start, not on a caller-stocked start", () => {
    const startTroops = [{ count: 3, rank: 0, type: "shield" as const },
      { count: 2, rank: 2, type: "archer" as const }];
    const fresh = simulate(worldFixture(homeScenario({ startTroops })));
    const soldiers = fresh.militarySoldiers();
    const { actors } = fresh.saveState();
    const homeUid = fresh.headquarters.uid;
    expect(soldiers.every(soldier => actors.find(actor => actor.uid === soldier.actor)?.home === homeUid)).toBe(true);
    expect(soldiers.map(soldier => soldier.rank)).toEqual([0, 0, 0, 2, 2]);
    const cargo = simulate(worldFixture(homeScenario({ startTroops })), { initialStock: { planks: 1 } });
    expect(cargo.militarySoldiers()).toHaveLength(0);
  });
});

describe("map rules in the scenario guard", () => {
  it("refuses options the map kind forbids and names them in the validation", () => {
    const world = worldFixture(homeScenario({ rules: { offlineCatchUp: "skip" } }));
    expect(isMapScenario(world.scenario, SIZE, SIZE)).toBe(false);
    expect(validateMapScenario(world)).toEqual(
      ["Home maps always catch up; only other maps may skip offline catch-up."]);
    expect(isMapScenario(homeScenario({ rules: { level: { kind: "fixed", level: 5 } } }), SIZE, SIZE)).toBe(false);
    expect(isMapScenario(homeScenario({ rules: { features: { trade: "off" }, talents: "none" } }), SIZE, SIZE))
      .toBe(true);
    expect(isMapScenario(homeScenario({ rules: { features: { trade: "on" } } as never }), SIZE, SIZE)).toBe(false);
    const adventure = { ...createMapScenario(), kind: "adventure" as const,
      rules: { level: { kind: "fixed" as const, level: 3 }, offlineCatchUp: "skip" as const } };
    expect(isMapScenario(adventure, SIZE, SIZE)).toBe(true);
  });
});

describe("campaign start setup", () => {
  it("allows switching the map's start setup off on campaign maps only, and then gives nothing", () => {
    const campaign = { ...createMapScenario(), kind: "campaign" as const, startSetup: "off" as const };
    expect(isMapScenario(campaign, SIZE, SIZE)).toBe(true);
    expect(isMapScenario(homeScenario({ startSetup: "off" }), SIZE, SIZE)).toBe(false);
    // The simulation applies the switch it is given (the guard keeps it to campaign maps).
    const off = simulate(worldFixture(homeScenario({ startSetup: "off",
      startTroops: [{ count: 2, rank: 0, type: "shield" }] })));
    expect(off.headquarters.inventory).toEqual({});
    expect(off.saveState().settlers).toBe(0);
    expect(off.militarySoldiers()).toHaveLength(0);
  });

  it("keeps cargo for expedition starts and leaves the map's start setup to a start without a home", () => {
    const cargo = { goods: [{ amount: 4, ware: "planks" }], settlers: 6, soldiers: [] };
    expect(campaignStartOptions({ cargo, nation: "roman" })).toMatchObject(
      { initialSettlers: 6, initialStock: { planks: 4 } });
    const noHome = campaignStartOptions({ nation: "roman" });
    expect("initialStock" in noHome).toBe(false);
    expect("initialSettlers" in noHome).toBe(false);
  });
});
