import { buildingRules } from "@shared/catalog/building-data/rules";
import { describe, expect, it } from "vitest";

import { getBuildingCardGroups, selectBuildingPicker } from "../src/app/settlement-ui/main-panel/build-helpers";
import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { MONUMENT_TYPE_ID } from "../src/render-common/buildings/monument-definition";
import {
  buildingLockReason, buildingsUnlockedAt, buildingUnlockLevel, isBuildingUnlocked
} from "../src/shared/progression/building-unlocks";
import { getConstructionCost } from "../src/shared/settlement/construction-costs";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { createMapScenario, isMapScenario } from "../src/shared/world/map-scenario";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const SIZE = 64;
const flatWorld = () => ({
  seed: 77, cellsX: SIZE, cellsZ: SIZE, seaLevel: -1, start: { x: 8.5, z: 8.5 },
  heights: new Float32Array((SIZE + 1) ** 2), blocking: new Uint8Array(SIZE ** 2),
  walkCost: new Uint8Array(SIZE ** 2).fill(10), buildClass: new Uint8Array(SIZE ** 2).fill(BUILD.large),
  oreAmount: new Uint8Array(SIZE ** 2), mineZone: new Uint16Array(SIZE ** 2), mineZones: [],
  props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
}) as unknown as WorldData;

/** The plan's unlock table, chapter by chapter (docs/archive/dated/flax-weaver-and-shipbuilding-plan-2026-10-27.md). */
const PLAN: Readonly<Record<number, readonly number[]>> = {
  1:[0,17,20,29,57],2:[19,33],3:[18,35],4:[22,37],5:[31,60],6:[32,61],7:[28],8:[3,21],9:[8],
  10:[5,58],11:[6,23],12:[11,12,27],13:[10,26],14:[25],15:[15,24],16:[1,40],17:[2,14],
  18:[36,39,41,42,43],19:[13],20:[59],21:[34],22:[4,45,46,47],23:[62],24:[16],25:[9],
  26:[49,50,51],28:[53,54,55],30:[7]
};
const EXEMPT = new Set([38,44,48,52,56]);

describe("building unlock levels", () => {
  it("matches the plan and covers every catalog type except the exempt ones", () => {
    for (const [level, types] of Object.entries(PLAN))
      expect([...buildingsUnlockedAt(Number(level))].sort((a, b) => a - b)).toEqual(types);
    for (const { id } of BUILDING_CATALOG)
      expect(EXEMPT.has(id) !== (buildingRules(id)?.unlockLevel !== undefined), `type ${id}`).toBe(true);
    expect(buildingUnlockLevel(42)).toBe(18);
  });

  it("gates each type from its level on; no level means no gate", () => {
    for (const [level, types] of Object.entries(PLAN)) for (const type of types) {
      expect(isBuildingUnlocked(type, Number(level) - 1)).toBe(false);
      expect(isBuildingUnlocked(type, Number(level))).toBe(true);
      expect(isBuildingUnlocked(type)).toBe(true);
    }
    expect(buildingLockReason(37)).toBe("Reach level 4 to build this");
  });

  it("places tools and cloth before the army and ships, and every normal unlock within 1–30",()=>{
    expect(buildingUnlockLevel(25)).toBeLessThan(buildingUnlockLevel(40));
    expect(buildingUnlockLevel(61)).toBeLessThan(buildingUnlockLevel(15));
    expect(buildingUnlockLevel(25)).toBeLessThan(buildingUnlockLevel(36));
    expect(buildingUnlockLevel(39)).toBe(18);
    expect(buildingUnlockLevel(62)).toBe(23);
    expect(buildingUnlockLevel(7)).toBe(30);
  });

  it("refuses a locked placement, offers it to the menu and reports its level", () => {
    const world = flatWorld();
    let level = 3;
    const simulation = createSettlementSimulation({ playerLevel: () => level, roads: createRoadNetwork(world), world });
    expect([simulation.allowsBuilding(18), simulation.allowsBuilding(37)]).toEqual([true, false]);
    expect(simulation.offersBuilding(37)).toBe(true);
    expect([simulation.buildingLockLevel(18), simulation.buildingLockLevel(58)]).toEqual([null, 10]);
    expect(simulation.placeBuilding(37, 30, 30)).toEqual({ ok: false, reason: "Reach level 4 to build this" });
    level = 4;
    expect(simulation.allowsBuilding(37)).toBe(true);
  });

  it("applies the spread gates to the same simulation the server replays", () => {
    const world = flatWorld();
    let level = 10;
    const simulation = createSettlementSimulation({ playerLevel: () => level, roads: createRoadNetwork(world), world });
    expect([24, 58, 13, 34, 4, 9].map(typeId => simulation.allowsBuilding(typeId)))
      .toEqual([false, true, false, false, false, false]);
    expect([simulation.buildingLockLevel(13), simulation.buildingLockLevel(34),
      simulation.buildingLockLevel(4), simulation.buildingLockLevel(9)]).toEqual([19, 21, 22, 25]);
    level = 19;
    expect([simulation.allowsBuilding(13), simulation.allowsBuilding(34), simulation.allowsBuilding(4)])
      .toEqual([true, false, false]);
    level = 22;
    expect([simulation.allowsBuilding(34), simulation.allowsBuilding(4), simulation.allowsBuilding(9)])
      .toEqual([true, true, false]);
    level = 25;
    expect(simulation.allowsBuilding(9)).toBe(true);
  });

  it("limits the Monument to one site on the home island", () => {
    const world = flatWorld(), cost = getConstructionCost(MONUMENT_TYPE_ID);
    const simulation = createSettlementSimulation({ roads: createRoadNetwork(world), world,
      initialStock: cost, initialSettlers: 0, unlockAllBuildings: true });
    expect(simulation.offersBuilding(MONUMENT_TYPE_ID)).toBe(true);
    const placed = simulation.placeBuilding(MONUMENT_TYPE_ID, 30.5, 30.5);
    if (!placed.ok) throw new Error(placed.reason);
    // The menu keeps the card, disabled as already built (owner 2026-11-10).
    expect(simulation.offersBuilding(MONUMENT_TYPE_ID)).toBe(true);
    expect(simulation.singleBuildingBuilt(MONUMENT_TYPE_ID)).toBe(true);
    expect(simulation.allowsBuilding(MONUMENT_TYPE_ID)).toBe(false);
    const allowed = BUILDING_CATALOG.filter(entry => simulation.offersBuilding(entry.id)).map(entry => entry.id);
    const cards = getBuildingCardGroups(selectBuildingPicker({ resources: {}, buildableTypes: allowed,
      builtBuildings: String(MONUMENT_TYPE_ID) })).flatMap(group => group.cards);
    const card = cards.find(entry => entry.id === MONUMENT_TYPE_ID);
    expect(card).toMatchObject({ hidden: false, lockText: "Already built", locked: true });
    expect(card?.title).toContain("Already built");
    const before = simulation.saveState();
    expect(simulation.placeBuilding(MONUMENT_TYPE_ID, 40.5, 40.5))
      .toEqual({ ok: false, reason: "Only one Monument can be built" });
    expect(simulation.validatePlacement(MONUMENT_TYPE_ID, 40.5, 40.5)).toBe("Only one Monument can be built");
    expect(simulation.saveState()).toEqual(before);
    // Demolition frees the slot.
    expect(simulation.demolishBuilding(placed.building!.uid).ok).toBe(true);
    expect(simulation.singleBuildingBuilt(MONUMENT_TYPE_ID)).toBe(false);
    expect(simulation.validatePlacement(MONUMENT_TYPE_ID, 40.5, 40.5)).not.toBe("Only one Monument can be built");
    expect(simulation.allowsBuilding(MONUMENT_TYPE_ID)).toBe(true);
    const colonyWorld = { ...flatWorld(), scenario: { ...createMapScenario(), kind: "colony" as const } };
    const colony = createSettlementSimulation({ roads: createRoadNetwork(colonyWorld), world: colonyWorld,
      initialStock: cost, initialSettlers: 0, unlockAllBuildings: true });
    expect(colony.offersBuilding(MONUMENT_TYPE_ID)).toBe(false);
    expect(colony.placeBuilding(MONUMENT_TYPE_ID, 30.5, 30.5))
      .toEqual({ ok: false, reason: "Monument can only be built on the home island" });
  });

  it("keeps a building placed before a gate rose valid in an existing save", () => {
    const world = flatWorld();
    let level = 21;
    const simulation = createSettlementSimulation({ playerLevel: () => level, roads: createRoadNetwork(world), world });
    expect(simulation.placeBuilding(34, 30.5, 30.5).ok).toBe(true);
    const saved = simulation.saveState();
    level = 10;
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    expect(simulation.saveState().buildings.some(building => building.typeId === 34)).toBe(true);
  });

  it("is bypassed without a player, by ?unlockall and by unlock-all scenarios", () => {
    const world = flatWorld();
    const roads = createRoadNetwork(world);
    expect(createSettlementSimulation({ roads, world }).allowsBuilding(9)).toBe(true);
    const flagged = createSettlementSimulation({ playerLevel: () => 1, roads, unlockAllBuildings: true, world });
    expect(flagged.buildingLockLevel(9)).toBeNull();
    const scenarioWorld = { ...flatWorld(), scenario: { ...createMapScenario(), buildingUnlocks: "all" as const } };
    const authored = createSettlementSimulation({
      playerLevel: () => 1, roads: createRoadNetwork(scenarioWorld), world: scenarioWorld
    });
    expect(authored.allowsBuilding(9)).toBe(true);
  });

  it("validates the scenario unlock mode", () => {
    const scenario = createMapScenario();
    expect(isMapScenario({ ...scenario, buildingUnlocks: "all" }, SIZE, SIZE)).toBe(true);
    expect(isMapScenario({ ...scenario, buildingUnlocks: "player-level" }, SIZE, SIZE)).toBe(true);
    expect(isMapScenario({ ...scenario, buildingUnlocks: "some" }, SIZE, SIZE)).toBe(false);
  });
});
