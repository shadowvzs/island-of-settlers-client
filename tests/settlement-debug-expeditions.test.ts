import { COLONY_LIFETIME_MS } from "@shared/catalog/balance";
import { describe, expect, it, vi } from "vitest";

import {
  colonySettlementOptions, planColonyArrival, settleArrivingColony
} from "../src/app/settlement/colony-boot";
import { debugExpeditionMessage, describeDebugGrant } from "../src/app/settlement/debug-expedition-message";
import { COLONY_DIFFICULTIES, COLONY_ORE_SHIP_MS, COLONY_SUPPLIES } from "../src/shared/balance/colonies";
import {
  adventureIslandError, adventureOffers, isAdventureIsland
} from "../src/shared/settlement/adventure-rules";
import {
  addAdventureRecord, addColonyRecord,   type Archipelago, type ColonyVisitRequest,
emptyArchipelago, expiredColonies, travelTo, updateColonyStatus} from "../src/shared/settlement/archipelago";
import { colonyIslandOffers, colonyTroopCount } from "../src/shared/settlement/colony-expedition-rules";
import { findExpeditionWorld } from "../src/shared/settlement/colony-world-choice";
import {
  DEBUG_EXPEDITION_TROOP_CAP, debugExpeditionIsland, expeditionTroopCap
} from "../src/shared/settlement/expedition-debug-rules";
import { expeditionRequiredSoldiers } from "../src/shared/settlement/expedition-launch-rules";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import {
  DEBUG_EXPEDITION_TROOPS, missingDebugTroops, missingGoods
} from "../src/shared/settlement/settlement-debug-expeditions";
import { MAX_SOLDIER_RANK } from "../src/shared/settlement/settlement-military-ranks";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

// Production code generates these islands itself: serve them from the shared world cache.
vi.mock("../src/shared/world/generation/generate-world", async (importOriginal) =>
  (await import("./helpers/world-cache-store")).cachedGenerateWorldModule(importOriginal));

const SIZE = 64, COAST = 36;
/** Flat land in the west, open sea from column 36 to the east edge. */
const world = () => {
  const heights = new Float32Array((SIZE + 1) ** 2);
  for (let z = 0; z <= SIZE; z++) for (let x = COAST; x <= SIZE; x++) heights[z * (SIZE + 1) + x] = -2;
  const data = { seed: 4, cellsX: SIZE, cellsZ: SIZE, seaLevel: -1, start: { x: 12.5, z: 12.5 }, heights,
    blocking: new Uint8Array(SIZE ** 2), walkCost: new Uint8Array(SIZE ** 2).fill(10),
    buildClass: new Uint8Array(SIZE ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(SIZE ** 2), mineZone: new Uint16Array(SIZE ** 2), mineZones: [],
    props: { count: 0, scale: new Float32Array(), types: new Uint8Array(), x: new Float32Array(),
      z: new Float32Array() }
  } as unknown as WorldData;
  for (let z = 0; z < SIZE; z++) for (let x = COAST; x < SIZE; x++) {
    data.walkCost[z * SIZE + x] = 0; data.blocking[z * SIZE + x] = 1;
  }
  return data;
};

/** A fresh settlement: headquarters only, no harbour, ship or soldiers. */
const freshSettlement = () => {
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const data = world();
  const roads = createRoadNetwork(data, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, initialSettlers: 30, roads, world: data });
  const advanceUntil = (done: () => boolean, seconds: number) => {
    for (let second = 0; second < seconds && !done(); second++) simulation.update(1);
    return done();
  };
  return { advanceUntil, simulation };
};
const expedition = (simulation: ReturnType<typeof freshSettlement>["simulation"]) =>
  simulation.colonyExpeditions()[0]!;
const DEBUG_TROOP_COUNT = colonyTroopCount(DEBUG_EXPEDITION_TROOPS);

describe("debug expedition timers", () => {
  const colony = colonyIslandOffers(7)[0]!;
  const test = debugExpeditionIsland(colony);

  it("keeps normal timings and troop limits on flagged islands", () => {
    expect(test).toEqual({ ...colony, debug: true, voyageSeconds: colony.voyageSeconds });
    expect(expeditionTroopCap(test)).toBe(COLONY_DIFFICULTIES[colony.difficulty].troopCap);
    expect(expeditionTroopCap(colony)).toBe(COLONY_DIFFICULTIES[colony.difficulty].troopCap);
    expect(DEBUG_TROOP_COUNT).toBeLessThanOrEqual(DEBUG_EXPEDITION_TROOP_CAP);
  });

  it("schedules ore ships and the lease of a test colony like a normal one", () => {
    const group = (island: typeof colony): Archipelago => ({ active: null, version: 1,
      colonies: [{ expeditionId: 1, island, status: "contested" }] });
    const conqueredAt = 1_000_000;
    const debugGroup = updateColonyStatus(group(test), 1, "conquered", conqueredAt);
    const normalGroup = updateColonyStatus(group(colony), 1, "conquered", conqueredAt);
    expect(debugGroup.colonies[0]!.nextOreShipAt).toBe(conqueredAt + COLONY_ORE_SHIP_MS);
    expect(normalGroup.colonies[0]!.nextOreShipAt).toBe(conqueredAt + COLONY_ORE_SHIP_MS);
    const later = conqueredAt + COLONY_LIFETIME_MS;
    expect(expiredColonies(debugGroup, later)).toHaveLength(1);
    expect(expiredColonies(normalGroup, later)).toHaveLength(1);
  });

  it("accepts only `debug: true` on saved islands", () => {
    const adventure = adventureOffers(7)[0]!;
    expect(adventureIslandError(debugExpeditionIsland(adventure))).toBeNull();
    expect(adventureIslandError({ ...adventure, debug: false })).toBe("Invalid adventure island");
  });
});

describe("debug expedition grants", () => {
  it("grants only the missing troops, at the top rank", () => {
    const troops = missingDebugTroops(DEBUG_EXPEDITION_TROOPS, { archer: 10, shield: 2 });
    expect(troops).toHaveLength(colonyTroopCount(DEBUG_EXPEDITION_TROOPS) - DEBUG_EXPEDITION_TROOPS.archer - 2);
    expect(troops.filter(troop => troop.type === "shield")).toHaveLength(DEBUG_EXPEDITION_TROOPS.shield - 2);
    expect(troops.some(troop => troop.type === "archer")).toBe(false);
    expect(troops.every(troop => troop.rank === MAX_SOLDIER_RANK && troop.hp > 0)).toBe(true);
    expect(missingGoods(COLONY_SUPPLIES, { planks: 25, stone: 5 })).toEqual({ hammer: 1, shovel: 1, stone: 10 });
  });

  it("raises a harbour, ships and troops on a fresh island and lands a test adventure", () => {
    const { advanceUntil, simulation } = freshSettlement();
    expect(simulation.ships().filter(ship => !ship.visitor)).toHaveLength(0);
    const started = simulation.startDebugExpedition("adventure");
    expect(started, JSON.stringify(started)).toMatchObject({ ok: true,
      granted: { crew: 0, harbourPlaced: true, ships: expect.any(Number), troops: DEBUG_TROOP_COUNT },
      island: { debug: true, kind: "adventure" } });
    const harbour = simulation.buildings().find(building => building.typeId === 39)!;
    expect(harbour).toMatchObject({ construction: 1 });
    expect(simulation.ships().filter(ship => !ship.visitor).length).toBeGreaterThanOrEqual(1);
    expect(started.ok && started.granted.ships).toBeGreaterThanOrEqual(1);
    expect(simulation.startDebugExpedition("colony"))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/under way/) });

    const saved = simulation.saveState();
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    expect(expedition(simulation).island).toMatchObject({ debug: true });
    expect(expedition(simulation).island.voyageSeconds).toBeGreaterThan(5);
    expect(advanceUntil(() => expedition(simulation).status === "arrived", 1200)).toBe(true);
    expect(simulation.colonyLanding(expedition(simulation).id)!.troops).toHaveLength(DEBUG_TROOP_COUNT);
  }, 60000);

  it("grants a colony crew and supplies and keeps normal expeditions untouched", () => {
    const { advanceUntil, simulation } = freshSettlement();
    const started = simulation.startDebugExpedition("colony");
    // No crew is granted: the HQ's idle settlers walk to the harbour (POP-01).
    expect(started, JSON.stringify(started)).toMatchObject({ ok: true,
      granted: { crew: 0, harbourPlaced: true, supplies: COLONY_SUPPLIES }, island: { debug: true } });
    expect(advanceUntil(() => expedition(simulation).status === "arrived", 1200)).toBe(true);
    expect(simulation.colonyLanding(expedition(simulation).id)).toMatchObject({ crew: 2, landed: COLONY_SUPPLIES });

    // The next test reuses the harbour; a normal start keeps the offered island and its voyage.
    const island = simulation.colonyIslands().find(entry => !entry.taken)!;
    const harbour = simulation.buildings().find(building => building.typeId === 39)!;
    harbour.inventory = { ...harbour.inventory, ...COLONY_SUPPLIES };
    const required = expeditionRequiredSoldiers(island);
    simulation.receiveTroops(Array.from({ length: required }, () => ({ hp: 10, rank: 0, type: "shield" as const })));
    expect(advanceUntil(() => simulation.ships().some(ship => !ship.visitor && ship.phase === "idle"), 1200))
      .toBe(true);
    expect(simulation.startColonyExpedition(harbour.uid, island.id, { shield: required })).toMatchObject({ ok: true });
    const normal = simulation.colonyExpeditions().find(entry => entry.island.id === island.id)!;
    expect(normal.island.debug).toBeUndefined();
    expect(normal.island.voyageSeconds).toBe(island.voyageSeconds);
  }, 60000);
});

/** The real boot path of a first visit: generate the island and land the expedition on it. */
const arriveAbroad = async (kind: "adventure" | "colony") => {
  const { advanceUntil, simulation: home } = freshSettlement();
  expect(home.startDebugExpedition(kind)).toMatchObject({ ok: true });
  expect(advanceUntil(() => expedition(home).status === "arrived", 1200)).toBe(true);
  const { id, island } = expedition(home), landing = home.colonyLanding(id)!;
  const group = isAdventureIsland(island) ? addAdventureRecord(emptyArchipelago(), id, island, landing)
    : addColonyRecord(emptyArchipelago(), id, island, landing);
  const homeSave: GameSaveV1 = { format: "island-settlers-game", map: "home", progress: { fog: { length: 0, packed: "" }, surveyed: [] },
    savedAt: 1, settlement: home.saveState(), version: 4 };
  const arrival = await planColonyArrival(travelTo(group, homeSave, id) as ColonyVisitRequest,
    async (expeditionIsland) => findExpeditionWorld(expeditionIsland));
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(arrival.world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ ...colonySettlementOptions(null, arrival),
    canWorkerEnterPlot: () => true, roads, world: arrival.world });
  expect(settleArrivingColony(simulation, arrival)).toEqual({ ok: true });
  return { simulation, world: arrival.world };
};

describe("test adventure and test colony arrive on different islands", () => {
  it("lands the adventure troops by gangway on a 96×96 island with mostly field camps", async () => {
    const { simulation, world } = await arriveAbroad("adventure");
    expect([world.cellsX, world.cellsZ]).toEqual([96, 96]);
    expect(simulation.buildings().every(site => site.bandit !== undefined)).toBe(true);
    expect(simulation.home()).toBeUndefined();
    expect(simulation.colony()).toBeUndefined();
    expect(simulation.shipSites().filter(site => site.kind === "dock")).toHaveLength(1);
    const hostile = simulation.militarySoldiers().filter(soldier => soldier.combat!.faction > 0);
    expect(hostile.length).toBeGreaterThan(0);
    expect(hostile.filter(soldier => !soldier.stationed).length).toBeGreaterThan(hostile.length * .75);
    expect(simulation.militarySoldiers().filter(soldier => soldier.combat!.faction === 0))
      .toHaveLength(DEBUG_TROOP_COUNT);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  }, 90000);

  it("lands the colony at its harbour on a 96×96 island with ore and garrisoned enemy forts", async () => {
    const { simulation, world } = await arriveAbroad("colony");
    expect([world.cellsX, world.cellsZ]).toEqual([96, 96]);
    expect(simulation.home()).toMatchObject({ colonyHome: true, typeId: 39 });
    expect(simulation.adventure()).toBeUndefined();
    const forts = simulation.buildings().filter(building => (building.militaryFaction ?? 0) > 0);
    expect(forts.length).toBeGreaterThanOrEqual(3);
    const garrisons = simulation.militarySoldiers()
      .filter(soldier => soldier.stationed && soldier.combat!.faction > 0);
    expect(new Set(garrisons.map(soldier => soldier.building))).toEqual(new Set(forts.map(fort => fort.uid)));
    const island = simulation.colony()!.island;
    expect(world.mineZones.filter(zone => zone.ore).length).toBeGreaterThan(0);
    expect(world.mineZones.filter(zone => zone.ore).every(zone => zone.surveyed)).toBe(true);
    // Contested: only military plots, not even the island's mine.
    const mine = { coal: 11, goldOre: 13, ironOre: 12, stone: 10 }[island.ore];
    expect(simulation.allowsBuilding(mine)).toBe(false);
    expect(simulation.shipSites().some(site => site.kind === "dock")).toBe(false);
  }, 90000);
});

describe("debug expedition messages", () => {
  const island = debugExpeditionIsland(adventureOffers(7)[0]!);
  const granted = { crew: 0, harbourPlaced: true, ships: 2, supplies: {}, troops: 20 };

  it("lists the grants and the test timers, or explains a failure", () => {
    const started = debugExpeditionMessage("adventure", { granted, id: 1, island, ok: true });
    expect(started.warning).toBe(false);
    expect(started.text).toContain("granted a finished harbour with a road, 2 ships, 20 veteran soldiers.");
    expect(started.text).toContain(`${island.voyageSeconds} s voyage`);
    expect(started.text).toMatch(/gangway on an island without buildings/);
    expect(debugExpeditionMessage("colony", { granted, id: 1, island, ok: true }).text)
      .toMatch(/pre-built harbour; ore mines unlock once the garrisoned enemy forts fall/);
    expect(describeDebugGrant({ ...granted, harbourPlaced: false, ships: 0, troops: 0 })).toBe("");
    expect(describeDebugGrant({ ...granted, crew: 1, supplies: { stone: 3 } })).toMatch(/1 crew settler, 3 stone$/);
    expect(debugExpeditionMessage("colony", { granted, id: 1, island, ok: true }, .25).text)
      .toContain("ore ship every 2700 s");
    expect(debugExpeditionMessage("colony", { ok: false, reason: "No coast" }))
      .toEqual({ text: "Test colony expedition: No coast.", warning: true });
  });
});
