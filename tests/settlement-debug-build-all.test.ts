import { describe, expect, it, vi } from "vitest";

import { runDebugBuildAll } from "../src/app/settlement/debug-build-all-runner";
import { buildAllMessage } from "../src/app/settlement/debug-tool-messages";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { DEBUG_BUILD_ALL_TYPES } from "../src/shared/settlement/settlement-debug-build-all";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, ORE, type WorldData } from "../src/shared/world/world-data";

const SIZE = 96, COAST = 70;
/** Colony-only gatherers, the retired Stable, then iron and gold mines without surveyed deposits. */
const HOME_SKIPPED = [41, 42, 43, 45, 46, 47, 49, 50, 51, 53, 54, 55, 38, 13, 12];
/** Mine types and their ores; only the coal and granite deposits below are surveyed. */
const DEPOSITS = [
  { id: 1, left: 8, ore: ORE.coal, surveyed: true },
  { id: 2, left: 16, ore: ORE.granite, surveyed: true },
  { id: 3, left: 24, ore: ORE.iron, surveyed: false }
];

/** Flat land in the west with three small deposits in the north, open sea from column 70. */
const world = () => {
  const heights = new Float32Array((SIZE + 1) ** 2);
  for (let z = 0; z <= SIZE; z++) for (let x = COAST; x <= SIZE; x++) heights[z * (SIZE + 1) + x] = -2;
  const data = { seed: 4, cellsX: SIZE, cellsZ: SIZE, seaLevel: -1, start: { x: 34.5, z: 40.5 }, heights,
    blocking: new Uint8Array(SIZE ** 2), walkCost: new Uint8Array(SIZE ** 2).fill(10),
    buildClass: new Uint8Array(SIZE ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(SIZE ** 2), mineZone: new Uint16Array(SIZE ** 2),
    mineZones: DEPOSITS.map(deposit => ({ cellCount: 16, centreX: deposit.left + 2, centreZ: 10, id: deposit.id,
      ore: deposit.ore, surveyed: deposit.surveyed })),
    props: { count: 0, scale: new Float32Array(), types: new Uint8Array(), x: new Float32Array(),
      z: new Float32Array() }
  } as unknown as WorldData;
  for (let z = 0; z < SIZE; z++) for (let x = COAST; x < SIZE; x++) {
    data.walkCost[z * SIZE + x] = 0; data.blocking[z * SIZE + x] = 1;
  }
  for (const deposit of DEPOSITS) for (let z = 8; z < 12; z++) for (let x = deposit.left; x < deposit.left + 4; x++) {
    data.oreAmount[z * SIZE + x] = 20; data.mineZone[z * SIZE + x] = deposit.id;
  }
  return data;
};

/** The same flat island with its eastern sea removed, so no waterfront plot exists. */
const inlandWorld = () => {
  const data = world();
  for (let z = 0; z < SIZE; z++) for (let x = COAST; x < SIZE; x++) {
    data.walkCost[z * SIZE + x] = 10; data.blocking[z * SIZE + x] = 0;
  }
  for (let z = 0; z <= SIZE; z++) for (let x = COAST; x <= SIZE; x++) data.heights[z * (SIZE + 1) + x] = 0;
  return data;
};

const freshSettlement = (data = world()) => {
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(data, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, initialSettlers: 80,
    resourceTargets: () => [], roads, world: data });
  return { data, roads, simulation };
};

describe("development: build every building", () => {
  it("attempts military buildings and mines only after the ordinary town", () => {
    const last = new Set([1, 2, 4, 9, 10, 11, 12, 13]);
    const firstDeferred = DEBUG_BUILD_ALL_TYPES.findIndex(type => last.has(type));
    expect(firstDeferred).toBeGreaterThan(0);
    expect(DEBUG_BUILD_ALL_TYPES.slice(0, firstDeferred).every(type => !last.has(type))).toBe(true);
    expect(DEBUG_BUILD_ALL_TYPES.slice(firstDeferred).every(type => last.has(type))).toBe(true);
    expect(new Set(DEBUG_BUILD_ALL_TYPES).size).toBe(DEBUG_BUILD_ALL_TYPES.length);
    for (const type of last) expect(DEBUG_BUILD_ALL_TYPES).toContain(type);
  });
  it("skips existing types, including construction sites, without changing buildings or roads", () => {
    const { roads, simulation } = freshSettlement();
    const first = simulation.debugRaiseBuilding(1);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    for (const progress of [1, 0, 0.5]) {
      first.building.construction = progress;
      const before = JSON.stringify(simulation.saveState());
      const roadSegments = JSON.stringify(roads.segments());
      expect(simulation.debugRaiseBuilding(1)).toEqual({ ok: false,
        reason: "building type already exists" });
      expect(simulation.saveState()).toEqual(JSON.parse(before));
      expect(JSON.stringify(roads.segments())).toBe(roadSegments);
    }
    expect(simulation.debugRaiseBuilding(2).ok).toBe(true);
  });

  it("creates no duplicates when the full command runs again", () => {
    const { simulation } = freshSettlement();
    for (const typeId of DEBUG_BUILD_ALL_TYPES) simulation.debugRaiseBuilding(typeId);
    const before = simulation.buildings().map(building => building.uid);
    const queued: Array<() => void> = [];
    let built = -1;
    runDebugBuildAll({ onDone: report => { built = report.built; },
      onRaised: () => { throw new Error("Repeated command created a duplicate"); },
      raise: typeId => simulation.debugRaiseBuildingSteps(typeId) }, next => queued.push(next));
    while (queued.length) queued.shift()!();
    expect(built).toBe(0);
    expect(simulation.buildings().map(building => building.uid)).toEqual(before);
  });

  it("raises one finished, road-connected building of every type it has a plot for", () => {
    const { roads, simulation } = freshSettlement();
    const started = performance.now();
    const results = DEBUG_BUILD_ALL_TYPES.map(typeId => ({ result: simulation.debugRaiseBuilding(typeId), typeId }));
    const elapsed = performance.now() - started;
    const skipped = results.filter(entry => !entry.result.ok).map(entry => entry.typeId);
    // Iron/gold lack surveyed deposits; colony-only gatherers stay off the home island.
    expect(skipped).toEqual(HOME_SKIPPED);
    const headquarters = simulation.headquarters;
    const raised = simulation.buildings().filter(building => building !== headquarters);
    expect(raised.map(building => building.typeId)).toEqual(DEBUG_BUILD_ALL_TYPES.filter(id => !skipped.includes(id)));
    for (const building of raised) {
      expect(building.construction).toBe(1);
      expect(roads.route(headquarters.access, building.access), `type ${building.typeId}`).not.toBeNull();
    }
    expect(elapsed).toBeLessThan(20_000);
  });

  it("staffs the raised buildings and survives save and load", () => {
    const { simulation } = freshSettlement();
    for (const typeId of DEBUG_BUILD_ALL_TYPES) simulation.debugRaiseBuilding(typeId);
    const count = simulation.buildings().length;
    for (let second = 0; second < 20; second++) simulation.update(1);
    expect(simulation.buildings().some(building => building.worker !== undefined)).toBe(true);
    const save = JSON.parse(JSON.stringify(simulation.saveState()));
    expect(simulation.loadState(save)).toEqual({ ok: true });
    expect(simulation.buildings()).toHaveLength(count);
    expect(simulation.buildings().every(building => building.construction === 1)).toBe(true);
  });

  it("skips mines without a surveyed matching deposit", () => {
    const { simulation } = freshSettlement();
    expect(simulation.debugRaiseBuilding(12)).toEqual({ ok: false,
      reason: "no surveyed matching deposit in your territory reachable by road" });
  });

  it("skips the Shipyard without a usable waterfront and leaves roads and terrain untouched", () => {
    const { data, roads, simulation } = freshSettlement(inlandWorld());
    const before = JSON.stringify(simulation.saveState());
    const roadBefore = JSON.stringify(roads.segments());
    const heights = data.heights.slice();
    expect(simulation.debugRaiseBuilding(36)).toEqual({ ok: false,
      reason: "no usable waterfront plot with a reachable launch site" });
    expect(JSON.stringify(simulation.saveState())).toBe(before);
    expect(JSON.stringify(roads.segments())).toBe(roadBefore);
    expect(data.heights).toEqual(heights);
  });

  it("rolls back the raised building, new roads and leveled terrain when the road link fails", () => {
    const { data, roads, simulation } = freshSettlement();
    const buildingsBefore = JSON.stringify(simulation.buildings());
    const occupiedBefore = JSON.stringify(simulation.saveState().occupied);
    const roadBefore = JSON.stringify(roads.segments());
    const heights = data.heights.slice();
    // Add the planned road but report failure, so the attempt is rolled back after both the
    // building and a new road already exist (the road tool lays the plan it checked).
    const addPlannedRoad = roads.addPlannedRoad.bind(roads);
    const add = vi.spyOn(roads, "addPlannedRoad").mockImplementation((plan) => {
      addPlannedRoad(plan);
      return false;
    });
    expect(simulation.debugRaiseBuilding(1).ok).toBe(false);
    expect(add).toHaveBeenCalled();
    // Cache/UID counters may advance to invalidate derived work, but no world or building state
    // from the failed attempt may remain.
    expect(JSON.stringify(simulation.buildings())).toBe(buildingsBefore);
    expect(JSON.stringify(simulation.saveState().occupied)).toBe(occupiedBefore);
    expect(JSON.stringify(roads.segments())).toBe(roadBefore);
    expect(data.heights).toEqual(heights);
  });

  it("raises a Shipyard on a legal waterfront and produces its boat", () => {
    const { roads, simulation } = freshSettlement();
    const result = simulation.debugRaiseBuilding(36);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const home = simulation.headquarters;
    expect(roads.route(home.access, result.building.access)).not.toBeNull();
    home.inventory.planks = Math.max(home.inventory.planks ?? 0, 20);
    for (let tick = 0; tick < 10_000 && !(home.inventory.boat ?? 0); tick++) simulation.update(.05);
    expect(home.inventory.boat).toBe(1);
  });

  it("yields between frames even when the clock does not advance", () => {
    const queued: Array<() => void> = [];
    let advanced = 0, done = false;
    runDebugBuildAll({
      onDone: () => { done = true; }, onRaised: () => {},
      raise: function* () {
        for (let step = 0; step < 100; step++) { advanced++; yield; }
        return { ok: false, reason: "no plot" };
      }
    }, next => queued.push(next), () => 0);
    expect(advanced).toBeLessThanOrEqual(8);
    expect(done).toBe(false);
    expect(queued).toHaveLength(1);
  });

  it("runs in slices between frames and reports skipped types by name", () => {
    const { simulation } = freshSettlement();
    const queued: Array<() => void> = [];
    let clock = 0, report: Parameters<typeof buildAllMessage>[0] | undefined;
    runDebugBuildAll({ onDone: done => { report = done; }, onRaised: () => {},
      raise: typeId => { clock += 5; return simulation.debugRaiseBuildingSteps(typeId); } },
    next => queued.push(next), () => clock);
    expect(report).toBeUndefined();
    while (queued.length) queued.shift()!();
    expect(report!.built).toBe(DEBUG_BUILD_ALL_TYPES.length - HOME_SKIPPED.length);
    const notice = buildAllMessage(report!, typeId => `type ${typeId}`);
    expect(notice.warning).toBe(true);
    expect(notice.text).toContain("type 13 (no surveyed matching deposit");
  });
});

it("blocks direct and stepped debug raising on a colony without changing roads, stock or buildings", () => {
  const { roads, simulation } = freshSettlement();
  simulation.headquarters.colonyHome = true;
  const before = JSON.stringify(simulation.saveState()), roadBefore = JSON.stringify(roads.segments());
  const refusal = { ok: false, reason: "Build every building is disabled on colonies" };
  expect(simulation.debugRaiseBuilding(1)).toEqual(refusal);
  expect(simulation.debugRaiseBuildingSteps(2).next()).toEqual({ done: true, value: refusal });
  expect(JSON.stringify(simulation.saveState())).toBe(before);
  expect(JSON.stringify(roads.segments())).toBe(roadBefore);
});
