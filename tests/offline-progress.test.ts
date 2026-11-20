import { describe, expect, it } from "vitest";

import { stageGameSession } from "../src/app/settlement/game-session";
import { createHeadlessIsland } from "../src/app/settlement/headless-replay";
import {
  advanceIsland, createOfflineIslandSession, type OfflineIslandMetrics
} from "../src/app/settlement/offline-island-replay";
import { advanceOfflineGame, chronologyPolicy, offlineSeconds } from "../src/app/settlement/offline-progress";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createGameSave, type GameSaveV1 } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import {
  resetMovementExecutionWork, snapshotMovementExecutionWork
} from "../src/shared/settlement/settlement-movement-executor";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { ORE } from "../src/shared/world/world-data";
import { huntingWorld } from "./helpers/hunting-world";

const fixture = async (construction = false, type = 33, stock: Record<string, number> = {}) => {
  const world = huntingWorld();
  if (type === 11) {
    world.mineZones = [{ id: 1, ore: ORE.coal, cellCount: 1, centreX: 22, centreZ: 20,
      richness: 1, surveyed: true }];
    world.mineZone[20 * world.cellsX + 22] = 1; world.oreAmount.fill(0);
    world.oreAmount[20 * world.cellsX + 22] = 10;
  }
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 20,
    initialStock: { logs: 20, planks: 100, stone: 100, saw: 1, hammer: 3, shovel: 3, pickaxe: 1, rollingPin: 1, crucible: 1, ...stock } });
  const [width, depth] = getBuildingDefinition(type).gridFootprint;
  const placed = simulation.placeBuilding(type, 20 + width / 2, 18 + depth / 2);
  if (!placed.ok || !placed.building) throw new Error(placed.reason);
  if (!construction) { placed.building.construction = 1; placed.building.required = {}; }
  expect(simulation.connectRoads(simulation.headquarters.access, placed.building.access)).toBe(true);
  const save = await createGameSave(world, simulation.saveState(), {
    name: "Offline regression", savedAt: 1_000_000, source: "generated", animals: [] });
  return { save, simulation, uid: placed.building.uid };
};
const wareTotal = (state: GameSaveV1["settlement"], ware: string) =>
  state.buildings.reduce((sum, building) => sum + (building.inventory[ware] ?? 0) +
    (building.input[ware] ?? 0) + (building.output[ware] ?? 0), 0) +
  state.storagePools.pools.reduce((sum, pool) => sum + (pool.available[ware] ?? 0), 0);

describe("offline progress", () => {
  it("ignores invalid clocks and time going backwards", () => {
    expect(offlineSeconds(1000, 500)).toBe(0);
    expect(offlineSeconds(NaN, 1000)).toBe(0);
    expect(offlineSeconds(1000, 61_000)).toBe(60);
  });

  it("splits an island replay into resumable chunks without changing the result", async () => {
    const { save } = await fixture();
    const replay = {
      archipelago: undefined,
      enemyCampsBlockJumps: false,
      exactBudgetSeconds: 1800,
      islandId: null,
      mode: "exact" as const,
      now: save.savedAt + 600_000,
      report: () => {},
      seconds: 600,
      start: save.savedAt
    };
    const session = await createOfflineIslandSession(save, replay);
    await session.advance(300);
    await session.advance(300);
    const chunked = await session.save(replay.now);
    const whole = await advanceIsland(save, replay);
    expect(chunked.settlement).toEqual(whole.settlement);
    expect(chunked.player).toEqual(whole.player);
    await expect(stageGameSession(chunked)).resolves.toBeDefined();
  }, 30000);

  it("falls back to exact ticks when the coverage audit finds an unsupported phase", async () => {
    const { save } = await fixture();
    const warmed = await advanceOfflineGame(structuredClone(save), save.savedAt + 1000, () => {},
      { exact: true, eventCore: false });
    expect(warmed.settlement.actors.length).toBeGreaterThan(0);
    warmed.settlement.actors[0]!.phase = "futureMechanic";
    const metrics: OfflineIslandMetrics[] = [];
    const result = await advanceOfflineGame(warmed, warmed.savedAt + 60_000, () => {}, {
      exact: true, onIslandMetrics: value => metrics.push(value)
    });
    expect(metrics[0]).toMatchObject({ mode: "exact", fallbackReason: "event-core-uncovered" });
    expect(metrics[0]!.eventCore).toBeUndefined();
    expect(metrics[0]!.eventCoreCoverage?.reasons).toContain("unknown-phase:futureMechanic");
    await expect(stageGameSession(result)).resolves.toBeDefined();
  }, 30000);

  it("retains explicit archived exact diagnostics and per-island metrics", async () => {
    const { save } = await fixture();
    const metrics: OfflineIslandMetrics[] = [];
    await advanceOfflineGame(save, save.savedAt + 600_000, () => {}, {
      exact: true,
      onIslandMetrics: value => metrics.push(value)
    });
    expect(metrics.length).toBeGreaterThan(0);
    expect(metrics[0]!.fixedTicks).toBeGreaterThan(0);
    expect(metrics[0]!.gameSeconds).toBeGreaterThan(0);
    expect(metrics[0]!.wallMs).toBeGreaterThanOrEqual(0);
    expect(metrics[0]).toMatchObject({
      requestedMode: "exact", mode: "exact", islandId: null
    });
    expect(metrics[0]!.measured).toBeUndefined();
    expect(metrics[0]!.fallbackReason).toBeUndefined();
  }, 30000);

  it("uses measured only when explicitly requested; explicit exact wins over it", async () => {
    const { save } = await fixture();
    const measured: OfflineIslandMetrics[] = [];
    await advanceOfflineGame(structuredClone(save), save.savedAt + 60_000, () => {}, {
      measured: true, onIslandMetrics: value => measured.push(value)
    });
    expect(measured[0]).toMatchObject({ requestedMode: "measured", mode: "measured" });
    expect(measured[0]!.measured).toBeDefined();

    const exact: OfflineIslandMetrics[] = [];
    await advanceOfflineGame(structuredClone(save), save.savedAt + 60_000, () => {}, {
      measured: true, exact: true, onIslandMetrics: value => exact.push(value)
    });
    expect(exact[0]).toMatchObject({ requestedMode: "exact", mode: "exact" });
    expect(exact[0]!.measured).toBeUndefined();

    const eventCore: OfflineIslandMetrics[] = [];
    await advanceOfflineGame(structuredClone(save), save.savedAt + 60_000, () => {}, {
      measured: true, eventCore: true, onIslandMetrics: value => eventCore.push(value)
    });
    expect(eventCore[0]).toMatchObject({ requestedMode: "exact", mode: "exact" });
    expect(eventCore[0]!.measured).toBeUndefined();

    const autoEventCore: OfflineIslandMetrics[] = [];
    await advanceOfflineGame(structuredClone(save), save.savedAt + 60_000, () => {}, {
      measured: true, eventCore: "auto", onIslandMetrics: value => autoEventCore.push(value)
    });
    expect(autoEventCore[0]).toMatchObject({ requestedMode: "exact", mode: "exact" });
    expect(autoEventCore[0]!.measured).toBeUndefined();
  }, 30000);

  it("coordinates exact-family multi-island replays by default and keeps measured sequential", () => {
    const multiple = { archipelago: { active: null, colonies: [], version: 1 } } as unknown as GameSaveV1;
    expect(chronologyPolicy(multiple, {})).toBe("coordinated");
    expect(chronologyPolicy(multiple, { measured: true })).toBe("sequential");
    expect(chronologyPolicy(multiple, { analytic: true })).toBe("sequential");
    expect(chronologyPolicy(multiple, { chronological: false })).toBe("sequential");
    expect(chronologyPolicy(multiple, { measured: true, chronological: true })).toBe("coordinated");
  });

  it("reports the actual mode and analytic fallback reason", async () => {
    const { save } = await fixture();
    const metrics: OfflineIslandMetrics[] = [];
    await advanceOfflineGame(save, save.savedAt + 3_700_000, () => {}, {
      analytic: true,
      onIslandMetrics: value => metrics.push(value)
    });
    expect(metrics[0]).toMatchObject({
      requestedMode: "analytic", mode: "measured", fallbackReason: "analytic-horizon-cap"
    });
  }, 30000);

  it("advances generic production work through the event core", async () => {
    const { save } = await fixture();
    const result = await advanceOfflineGame(save, save.savedAt + 600_000, () => {}, { eventCore: true });
    expect(wareTotal(result.settlement, "planks")).toBeGreaterThan(100);
    expect(wareTotal(result.settlement, "logs")).toBeLessThan(20);
    await expect(stageGameSession(result)).resolves.toBeDefined();
  }, 30000);

  it("runs the opt-in movement executor without losing production", async () => {
    const { save } = await fixture();
    resetMovementExecutionWork();
    const result = await advanceOfflineGame(save, save.savedAt + 600_000, () => {}, {
      exact: true, corridorReservations: true, eventMovement: true
    });
    expect(wareTotal(result.settlement, "planks")).toBeGreaterThan(100);
    expect(wareTotal(result.settlement, "logs")).toBeLessThan(20);
    const work = snapshotMovementExecutionWork();
    expect(work.advanceTicks).toBeGreaterThan(0);
    expect(work.advanceArrivals + work.advanceHandoffs).toBeGreaterThan(0);
    await expect(stageGameSession(result)).resolves.toBeDefined();
  }, 30000);

  it("keeps exact reference production, finite inputs and replay cursor available for a long gap", async () => {
    const { save } = await fixture();
    const result = await advanceOfflineGame(save, save.savedAt + 3_600_000, () => {}, { exact: true });
    expect(wareTotal(result.settlement, "planks")).toBeGreaterThan(100);
    expect(wareTotal(result.settlement, "logs")).toBeLessThan(20);
    expect(wareTotal(result.settlement, "planks") - 100)
      .toBe(20 - wareTotal(result.settlement, "logs"));
    expect(result.savedAt).toBe(save.savedAt + 3_600_000);
    await expect(stageGameSession(result)).resolves.toBeDefined();
    expect(await advanceOfflineGame(result, result.savedAt)).toBe(result);
    expect(wareTotal(save.settlement, "logs")).toBe(20);
  }, 30000);

  it("finishes construction through scheduled builder contacts", async () => {
    const { save, uid } = await fixture(true);
    const result = await advanceOfflineGame(save, save.savedAt + 600_000, () => {}, { eventCore: true });
    expect(result.settlement.buildings.find(building => building.uid === uid)?.construction).toBe(1);
    await expect(stageGameSession(result)).resolves.toBeDefined();
  }, 30000);

  it("finishes construction using the actual builder, materials and connected roads", async () => {
    const { save, uid } = await fixture(true);
    const result = await advanceOfflineGame(save, save.savedAt + 600_000, () => {}, { exact: true, eventCore: false });
    expect(result.settlement.buildings.find(building => building.uid === uid)?.construction).toBe(1);
    expect(wareTotal(result.settlement, "planks")).toBeGreaterThan(90);
    await expect(stageGameSession(result)).resolves.toBeDefined();
  }, 30000);
  it("consumes one food per mined ore and stops when food runs out", async () => {
    const { save } = await fixture(false, 11, { fish: 2, meat: 0, bread: 0 });
    const result = await advanceOfflineGame(save, save.savedAt + 3_600_000, () => {}, { exact: true, eventCore: false });
    const loaded = await stageGameSession(result);
    expect(wareTotal(result.settlement, "coal")).toBe(2);
    expect(wareTotal(result.settlement, "fish")).toBe(0);
    expect(loaded.map.world.oreAmount.reduce((sum, amount) => sum + amount, 0)).toBe(8);
    const again = await advanceOfflineGame(result, result.savedAt + 600_000, () => {}, { exact: true, eventCore: false });
    expect(wareTotal(again.settlement, "coal")).toBe(2);
  }, 30000);

  it.each([
    [23, { grain: 2, water: 1 }, "beer"],
    [26, { ironOre: 1, coal: 1 }, "iron"],
    [31, { grain: 1 }, "flour"],
    [32, { flour: 1, water: 1 }, "bread"]
  ] as const)("respects the recipe and limiting input of building %s", async (type, inputs, output) => {
    const { save } = await fixture(false, type, inputs);
    const result = await advanceOfflineGame(save, save.savedAt + 600_000, () => {}, { exact: true, eventCore: false });
    expect(wareTotal(result.settlement, output), JSON.stringify({
      buildings: result.settlement.buildings.map(b => ({ type: b.typeId, status: b.status, input: b.input, output: b.output })),
      actors: result.settlement.actors.map(a => ({ phase: a.phase, job: a.job, ware: a.ware })) })).toBe(1);
    await expect(stageGameSession(result)).resolves.toBeDefined();
  }, 30000);

  it("does not produce through a disconnected road", async () => {
    const { save } = await fixture(); save.settlement.roads = [];
    const result = await advanceOfflineGame(save, save.savedAt + 600_000, () => {}, { exact: true, eventCore: false });
    expect(wareTotal(result.settlement, "planks")).toBe(100);
    expect(wareTotal(result.settlement, "logs")).toBe(20);
  }, 30000);

  // The exact lane ticks the raid; the fast economy lane applies the estimate of offline-civilian-raid.ts.
  it.each([["exact", { exact: true, eventCore: false }], ["fast", {}]] as const)(
    "lets enemies kill villagers outside buildings while the player is away (%s catch-up)", async (_lane, options) => {
      const { save, simulation, uid } = await fixture(true);
      for (let tick = 0; tick < 300; tick++) simulation.update(.05);
      const site = simulation.buildings().find(building => building.uid === uid)!;
      const { access } = simulation.headquarters;
      const middle = { x: (access.x + site.access.x) / 2, z: (access.z + site.access.z) / 2 + 1.5 };
      for (let index = 0; index < 3; index++)
        simulation.spawnMilitaryOpponent({ x: middle.x + index * .8, z: middle.z }, "heavy", 0, 1);
      save.settlement = simulation.saveState();
      const result = await advanceOfflineGame(save, save.savedAt + 120_000, () => {}, options);
      expect(result.settlement.military?.combat?.civilianDeaths).toBeGreaterThan(0);
      await expect(stageGameSession(result)).resolves.toBeDefined();
      // The island plays on from the result: the dead are gone and nothing refers to them.
      const { simulation: resumed } = await createHeadlessIsland(result);
      for (let tick = 0; tick < 200; tick++) resumed.update(.05);
      expect(resumed.loadState(resumed.saveState())).toEqual({ ok: true });
    }, 60000);

  it("continues an ongoing battle, including casualties", async () => {
    const { save, simulation } = await fixture();
    simulation.spawnMilitaryOpponent({ x: 40, z: 40 }, "shield", 0, 1);
    simulation.spawnMilitaryOpponent({ x: 40.7, z: 40 }, "heavy", 2, 2);
    save.settlement = simulation.saveState();
    const before = save.settlement.military!.soldiers!.length;
    const result = await advanceOfflineGame(save, save.savedAt + 120_000, () => {}, { exact: true, eventCore: false });
    const alive = result.settlement.military!.soldiers!.filter(soldier => (soldier.combat?.hp ?? 1) > 0);
    expect(alive.length).toBeLessThan(before);
    await expect(stageGameSession(result)).resolves.toBeDefined();
  }, 30000);

});
