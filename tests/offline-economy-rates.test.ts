import { beforeAll, describe, expect, it, vi } from "vitest";

import { runOfflineEconomyEvents } from "../src/app/settlement/offline-economy-events";
import { estimateOfflineEconomyRates, OFFLINE_ECONOMY_TICKS_PER_SECOND, offlineStockTripSeconds } from "../src/app/settlement/offline-economy-rates";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import * as stockAnchors from "../src/render-common/buildings/building-stock-anchors";
import { createGameSave, type GameSaveV1 } from "../src/shared/settlement/game-save";
import { mixedCycleOutput } from "../src/shared/settlement/mixed-output";
import { getBuildingProductionRule } from "../src/shared/settlement/production-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { savedOccupancy } from "../src/shared/settlement/save-cell-codecs";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementActor, SettlementBuilding } from "../src/shared/settlement/settlement-types";
import type { WorldData } from "../src/shared/world/world-data";
import { huntingWorld } from "./helpers/hunting-world";

let source: GameSaveV1, world: WorldData, producer: SettlementBuilding;
const scenario = (...types: number[]) => {
  const save = structuredClone(source);
  save.settlement.buildings = [save.settlement.buildings[0]!, ...types.map((typeId, index) =>
    ({ ...structuredClone(producer), uid: index + 100, typeId, worker: index + 200 }))];
  return save;
};
beforeAll(async () => {
  world = huntingWorld();
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 30,
    initialStock: { logs: 100, planks: 30, stone: 30, saw: 1 } });
  const [width, depth] = getBuildingDefinition(33).gridFootprint;
  const placed = simulation.placeBuilding(33, 16 + width / 2, 10 + depth / 2);
  if (!placed.ok) throw new Error(placed.reason);
  producer = placed.building!;
  Object.assign(producer, { construction: 1, foundationProgress: 1, required: {}, worker: 100 });
  if (!simulation.connectRoads(simulation.headquarters.access, producer.access)) throw new Error("fixture roads");
  source = await createGameSave(world, simulation.saveState(), { name: "rates fixture", savedAt: 1_000_000,
    source: "generated", animals: [] });
});

describe("offline economy static rates", () => {
  it("uses saved nation/upgrade and actual input/output inventories for canonical packed stock travel", () => {
    const save = scenario(61, 35); save.settlement.playerNation = "maya";
    for (const building of save.settlement.buildings.slice(1)) {
      building.workshopUpgrade = { level: 4 };
      building.input = { flax: 2 }; building.output = { cloth: 3, water: 2 };
    }
    const spy = vi.spyOn(stockAnchors, "getBuildingStockContact");
    try {
      const weaver = save.settlement.buildings[1]!;
      expect(offlineStockTripSeconds(weaver, "output", "cloth", "maya")).toBeGreaterThan(0);
      estimateOfflineEconomyRates(save, world);
      expect(spy.mock.calls.length).toBeGreaterThan(6);
      for (const call of spy.mock.calls) {
        const building = save.settlement.buildings.find(building => building.typeId === call[0])!;
        expect(call[10]).toEqual({ nation: "maya", level: 5 });
        expect(call[8]).toBe(call[1] === "input" ? building.input : building.output);
        expect(call[9]).toBe(call[1] === "input" ? building.output : building.input);
      }
    } finally { spy.mockRestore(); }
  });

  it("bounds an automatic slaughterhouse to twelve cycles per fast day", () => {
    const job = estimateOfflineEconomyRates(scenario(21), world).jobs[0]!;
    expect(job.outputSequence).toHaveLength(12);
    expect(job.outputSequence).toEqual(Array.from({ length: 12 }, () => ({ meat: 1 })));
  });

  it("charges one leather and one cloth for each armour and stops when cloth runs out", () => {
    const save = scenario(15);
    const job = estimateOfflineEconomyRates(save, world).jobs[0]!;
    expect(job.inputs).toEqual({ leather: 1, cloth: 1 });
    expect(job.outputs).toEqual({ armor: 1 });
    const result = runOfflineEconomyEvents({ horizonTicks: job.cycleTicks * 4,
      islands: [{ islandId: "home", stock: { leather: 3, cloth: 2 } }], jobs: [job] });
    expect(result.islands[0]!.produced).toEqual({ armor: 2 });
    expect(result.islands[0]!.consumed).toEqual({ leather: 2, cloth: 2 });
    const remainingLeather = result.islands[0]!.stock.leather! +
      result.buffers.reduce((sum, buffer) => sum + (buffer.stock.leather ?? 0) +
        (buffer.deliveredStock?.leather ?? 0) + (buffer.directStock?.leather ?? 0) +
        (buffer.ownedStock?.leather ?? 0), 0);
    expect(remainingLeather).toBe(1);
  });
  it("keeps a detached warehouse outside the home production stock component", () => {
    const save = scenario(33);
    const detached = structuredClone(save.settlement.buildings[0]!);
    detached.uid = 999; detached.typeId = 29; detached.access = { x: 55, z: 55 };
    save.settlement.buildings.push(detached);
    expect(estimateOfflineEconomyRates(save, world).storageUids).toEqual([save.settlement.buildings[0]!.uid]);
  });
  it("reserves a finite armory order already paid by the saved worker", () => {
    const save = scenario(24);
    save.settlement.buildings[1]!.productionOrders = { sword: 1, shield: 0, axe: 0, bow: 0 };
    save.settlement.actors.push({ uid: 200, building: 100, productionOutput: "sword",
      productionSeconds: 8 } as SettlementActor);
    const result = estimateOfflineEconomyRates(save, world);
    expect(result.jobs[0]!.outputSequence).toEqual([]);
    expect(save.settlement.buildings[1]!.productionOrders.sword).toBe(1);
  });
  it("leaves a paid Armory receipt with its retained worker across long gaps and retries", () => {
    const save = scenario(24);
    save.settlement.buildings[1]!.productionOrders = { sword: 1, shield: 0, axe: 0, bow: 0 };
    save.settlement.actors.push({ uid: 200, building: 100, home: 0, x: producer.x, z: producer.z,
      y: 0, yaw: 0, visible: true, job: "Armorer", action: "work", ware: null, phase: "work",
      path: [], pathIndex: 0, timer: 8, animationTime: 0, productionOutput: "sword",
      productionSeconds: 8, consumed: { iron: 1, coal: 1 } });
    const original = JSON.stringify(save);
    for (const seconds of [.05, 86_400]) for (const snapshot of [save, JSON.parse(original) as GameSaveV1]) {
      const job = estimateOfflineEconomyRates(snapshot, world).jobs[0]!;
      const horizonTicks = seconds * OFFLINE_ECONOMY_TICKS_PER_SECOND;
      const result = runOfflineEconomyEvents({ horizonTicks,
        islands: [{ islandId: "home", stock: {} }],
        jobs: [{ ...job, endTick: horizonTicks }] });
      expect(result.islands[0]!.produced).toEqual({});
      expect(result.islands[0]!.consumed).toEqual({});
      expect(JSON.stringify(snapshot)).toBe(original);
    }
  });
  it("uses real recipes and millisecond cycle ticks without changing the save", () => {
    const save = scenario(33), before = JSON.stringify(save);
    const result = estimateOfflineEconomyRates(save, world);
    expect(result.unsupported).toEqual([]);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({ islandId: "home", inputs: { logs: 1 }, outputs: { planks: 1 } });
    expect(result.jobs[0]!.cycleTicks).toBe(Math.ceil(result.buildings[0]!.cycleSeconds * OFFLINE_ECONOMY_TICKS_PER_SECOND));
    expect(result.buildings[0]!.workSeconds).toBe(5);
    expect(JSON.stringify(save)).toBe(before);
  });
  it("uses nation-specific recipes and selected outputs", () => {
    const save = scenario(6, 25);
    save.settlement.playerNation = "japanese";
    save.settlement.buildings[2]!.selectedOutput = "axe";
    const result = estimateOfflineEconomyRates(save, world);
    expect(result.jobs[0]).toMatchObject({ inputs: { rice: 1, water: 1 }, outputs: { sake: 1 } });
    expect(result.jobs[1]).toMatchObject({ inputs: { iron: 1, planks: 1 }, outputs: { axe: 1 } });
  });
  it("produces deterministic mixed outputs one paid cycle at a time", () => {
    const save = scenario(25), building = save.settlement.buildings[1]!;
    building.cycle = 7;
    const before = JSON.stringify(save);
    const result = estimateOfflineEconomyRates(save, world), job = result.jobs[0]!;
    const outputs = getBuildingProductionRule(building, "roman")!.outputs;
    expect(job.inputs).toEqual({ iron: 1, planks: 1 });
    expect(job.outputs).toEqual(Object.fromEntries(outputs.map(ware => [ware, 0])));
    expect(job.outputSequence!.slice(0, 3)).toEqual([0, 1, 2].map(offset =>
      ({ [mixedCycleOutput({ ...building, cycle: building.cycle + offset }, outputs)]: 1 })));
    const first = runOfflineEconomyEvents({ horizonTicks: job.cycleTicks * 2, jobs: [job],
      islands: [{ islandId: "home", stock: { iron: 1, planks: 1 } }] });
    expect(first.completedCycles[job.uid]).toBe(1);
    expect(first.islands[0]!.produced).toEqual(job.outputSequence![0]);
    expect(JSON.stringify(save)).toBe(before);
  });
  it("respects finite armory orders and preserves missing unlimited orders", () => {
    const save = scenario(24), building = save.settlement.buildings[1]!;
    building.cycle = 1;
    building.productionOrders = { shield: 1, sword: 0, axe: 2, bow: 0 };
    const before = JSON.stringify(save);
    const result = estimateOfflineEconomyRates(save, world), job = result.jobs[0]!;
    expect(result.unsupported).toEqual([]);
    expect(job.inputs).toEqual({ iron: 1, coal: 1 });
    expect(job.outputSequence).toEqual([{ axe: 1 }, { shield: 1 }, { axe: 1 }]);
    const completed = runOfflineEconomyEvents({ horizonTicks: job.cycleTicks * 10, jobs: [job],
      islands: [{ islandId: "home", stock: { iron: 10, coal: 10 } }] });
    const held = { ...completed.islands[0]!.stock };
    for (const buffer of completed.buffers) for (const [ware, units] of Object.entries(buffer.stock))
      held[ware] = (held[ware] ?? 0) + units;
    expect(held).toEqual({ iron: 7, coal: 7, axe: 2, shield: 1 });
    expect(completed.inProgress).toEqual([]);
    expect(JSON.stringify(save)).toBe(before);
    delete building.productionOrders;
    const automatic = estimateOfflineEconomyRates(save, world).jobs[0]!;
    const sequence = automatic.outputSequence!;
    expect(sequence.slice(0, 4))
      .toEqual([{ sword: 1 }, { axe: 1 }, { bow: 1 }, { shield: 1 }]);
    // Automatic production is a bounded peacetime kit; explicit orders above are exact.
    expect(sequence).toHaveLength(8);
    expect(sequence.reduce<Record<string, number>>((sum, output) => {
      for (const [ware, units] of Object.entries(output)) sum[ware] = (sum[ware] ?? 0) + units;
      return sum;
    }, {})).toEqual({ axe: 2, bow: 2, shield: 2, sword: 2 });
  });
  it("marks finite resource requirements and miner alternative food", () => {
    const result = estimateOfflineEconomyRates(scenario(12, 17, 18, 19), world);
    expect(result.jobs[0]).toMatchObject({ inputs: { "~ore:100": 1 }, alternativeFoods: ["fish", "meat", "bread"] });
    expect(result.jobs[1]!.inputs).toEqual({ "~tree:17": 1 });
    expect(result.jobs[2]!.inputs).toEqual({ "~source:102": 1 });
    expect(result.jobs[3]!.inputs).toEqual({ "~source:103": 1 });
    expect(result.buildings[1]!.workerTravelSeconds).toBeGreaterThan(0);
  });
  it("reports charcoal batch and field/animal approximations", () => {
    const save = scenario(27, 37, 28), charcoal = save.settlement.buildings[1]!;
    save.settlement.fields = [{ id: 77, owner: charcoal.uid, kind: "charcoal",
      x: charcoal.workerApproach.x + 2, z: charcoal.workerApproach.z + 2,
      state: "stubble", progress: 0, step: 0 }];
    const result = estimateOfflineEconomyRates(save, world);
    expect(result.jobs[0]).toMatchObject({ inputs: { logs: 6 }, outputs: { coal: 6 } });
    expect(result.buildings[0]!.reason).toContain("charcoal full pile");
    expect(result.buildings[1]!.reason).toContain("field sow and harvest");
    expect(result.buildings[2]!.reason).toContain("animal feeding");
  });
  it("does not invent charcoal production without a saved pile", () => {
    const result = estimateOfflineEconomyRates(scenario(27), world);
    expect(result.jobs).toEqual([]);
    expect(result.unsupported).toContainEqual({ uid: 100, reason: "no reachable charcoal field site" });
  });
  it("keeps worker periods separate from shared carrier work and caches endpoint routes", () => {
    const result = estimateOfflineEconomyRates(scenario(...Array<number>(30).fill(33)), world);
    expect(result.routes.equivalentCarriers).toBe(1);
    expect(result.routes.globalThrottle).toBeGreaterThan(1);
    for (const row of result.buildings) {
      expect(row.cycleSeconds).toBeGreaterThanOrEqual(row.workSeconds);
      expect(row.cycleSeconds).toBeLessThan(row.carrierSeconds);
    }
    // Outbound collection and inbound input supply may use opposite endpoint directions.
    expect(result.routes.hits).toBeGreaterThanOrEqual(29);
    expect(result.routes.misses).toBeLessThanOrEqual(2);
    expect(result.routes.entries).toBe(result.routes.misses);
  });
  it("uses the well's local bucket trip rather than the storage carrier round trip", () => {
    const result = estimateOfflineEconomyRates(scenario(35), world), rate = result.buildings[0]!;
    expect(rate.workSeconds).toBe(7);
    expect(rate.workerTravelSeconds).toBeGreaterThan(0);
    // Authored work7s + scaled rest1s + two scaled handoffs, plus local walking.
    expect(rate.cycleSeconds).toBeCloseTo(9 + rate.workerTravelSeconds);
    expect(rate.cycleSeconds).toBeLessThan(rate.carrierSeconds);
    expect(rate.reason).toContain("authored windlass/pickup/shelf");
  });
  it("charges boat self-delivery to the worker and only input planks to carriers", () => {
    const save = scenario(33, 36), result = estimateOfflineEconomyRates(save, world);
    const boat = result.buildings[1]!, mill = result.buildings[0]!;
    expect(boat.workSeconds).toBe(14);
    expect(boat.reason).toContain("native courtyard/prop-aware ground paths");
    expect(boat.workerTravelSeconds).toBeGreaterThan(0);
    expect(boat.cycleSeconds).toBeGreaterThan(boat.workerTravelSeconds + boat.workSeconds);
    // Both fixture jobs share the same access/storage route. A sawmill has one input and one
    // output carrier trip; the shipwright's own boat delivery must not charge that second trip.
    expect(boat.carrierSeconds * 2).toBeCloseTo(mill.carrierSeconds);
    expect(boat.reason).toContain("shipwright carries each boat home");
    expect(result.jobs[1]!.inputs).toEqual({ planks: 1 });
    expect(result.jobs[1]!.outputs).toEqual({ boat: 1 });
  });
  it("uses physical road distance and the real home rather than a stale shipwright home", () => {
    const save = scenario(36);
    const ordinary = estimateOfflineEconomyRates(save, world).buildings[0]!;
    const store = structuredClone(save.settlement.buildings[0]!);
    store.uid = 999; store.typeId = 29; store.access = { ...save.settlement.buildings[1]!.access };
    save.settlement.buildings.push(store);
    save.settlement.actors.push({ uid: 200, home: 999, locomotionSpeed: .45 } as SettlementActor);
    expect(estimateOfflineEconomyRates(save, world).buildings[0]!.workerTravelSeconds)
      .toBeCloseTo(ordinary.workerTravelSeconds);
    const upgraded = structuredClone(save);
    for (const segment of upgraded.settlement.roads) segment.tier = "granite";
    const fasterCarriers = estimateOfflineEconomyRates(upgraded, world).buildings[0]!;
    expect(fasterCarriers.workerTravelSeconds).toBeCloseTo(ordinary.workerTravelSeconds);
    expect(fasterCarriers.carrierSeconds).toBeLessThan(ordinary.carrierSeconds);
    expect(ordinary.cycleSeconds).toBeGreaterThan(ordinary.workerTravelSeconds + 14);
  });
  it("waits for an already-paid boat delivery before giving its worker new work", () => {
    const save = scenario(36), home = save.settlement.buildings[0]!;
    save.settlement.actors.push({ uid: 200, home: home.uid, building: 100, phase: "home", ware: "boat",
      boatWork: 1, x: home.access.x + 2, z: home.access.z,
      path: [{ ...home.access }], pathIndex: 0 } as SettlementActor);
    const result = estimateOfflineEconomyRates(save, world), boat = result.jobs[0]!;
    expect(boat.firstTick).toBeGreaterThan(2000);
    const early = runOfflineEconomyEvents({ horizonTicks: boat.firstTick!, jobs: [boat],
      islands: [{ islandId: "home", stock: { planks: 20 } }] });
    expect(early.islands[0]!.produced).toEqual({});
    expect(early.islands[0]!.consumed).toEqual({});
    expect(save.settlement.actors.at(-1)!.ware).toBe("boat");
  });
  it("charges ordinary workshop workers for each real stock pickup and output return", () => {
    const result = estimateOfflineEconomyRates(scenario(25), world), row = result.buildings[0]!;
    expect(row.workerTravelSeconds).toBeGreaterThan(0);
    expect(row.cycleSeconds).toBeGreaterThan(row.workSeconds + row.workerTravelSeconds);
    const delivery = result.jobs[0]!.inputDeliveryTicks!;
    expect(Object.keys(delivery).sort()).toEqual(["iron", "planks"]);
    expect(Object.values(delivery).every(ticks => Number.isSafeInteger(ticks) && ticks > 2000)).toBe(true);
  });
  it("does not source a ware from a nearer empty warehouse", () => {
    const save = scenario(33), workshop = save.settlement.buildings[1]!;
    const before = estimateOfflineEconomyRates(save, world).jobs[0]!.inputDeliveryTicks!.logs!;
    const empty = { ...structuredClone(save.settlement.buildings[0]!), uid: 999, typeId: 29,
      inventory: {}, access: { ...workshop.access }, doorThreshold: { ...workshop.access },
      workerApproach: { ...workshop.access } };
    save.settlement.buildings.push(empty);
    expect(estimateOfflineEconomyRates(save, world).jobs[0]!.inputDeliveryTicks!.logs).toBe(before);
    empty.inventory = { logs: 1 };
    expect(estimateOfflineEconomyRates(save, world).jobs[0]!.inputDeliveryTicks!.logs).toBeLessThan(before);
  });
  it("uses owned wheat plots instead of charging maximum-radius travel to every farm visit", () => {
    const save = scenario(37), building = save.settlement.buildings[1]!;
    const fallback = estimateOfflineEconomyRates(save, world).buildings[0]!;
    const point = { x: building.workerApproach.x + 2, z: building.workerApproach.z + 2 };
    save.settlement.fields = [{ id: Math.floor(point.z) * world.cellsX + Math.floor(point.x),
      owner: building.uid, kind: "grain", ...point, state: "ripe", progress: 1, step: 0 }];
    const before = JSON.stringify(save);
    const owned = estimateOfflineEconomyRates(save, world).buildings[0]!;
    expect(owned.workerTravelSeconds).toBeLessThan(fallback.workerTravelSeconds);
    expect(owned.workSeconds).toBe(fallback.workSeconds);
    expect(owned.reason).toContain("saved owned crop/pile geometry");
    expect(JSON.stringify(save)).toBe(before);
    save.settlement.fields[0]!.owner = 999;
    expect(estimateOfflineEconomyRates(save, world).buildings[0]!.workerTravelSeconds)
      .toBe(fallback.workerTravelSeconds);
  });
  it("amortizes owned crop growth concurrently with the worker's harvest service", () => {
    const save = scenario(37), building = save.settlement.buildings[1]!;
    const fields: GameSaveV1["settlement"]["fields"] = [];
    const origin = building.workerApproach;
    for (let dz = -6; dz <= 6 && fields.length < 9; dz++) for (let dx = -6; dx <= 6; dx++) {
      const x = Math.floor(origin.x) + dx + .5, z = Math.floor(origin.z) + dz + .5;
      const id = Math.floor(z) * world.cellsX + Math.floor(x);
      if (dx * dx + dz * dz < 4 || !world.walkCost[id] || savedOccupancy(save.settlement)[id] === 1) continue;
      fields.push({ id, owner: building.uid, kind: "grain", x, z, state: "ripe", progress: 1, step: 0 });
      if (fields.length === 9) break;
    }
    if (fields.length < 9) throw new Error("fixture needs nine walkable owned plots");
    save.settlement.fields = [fields[0]!];
    const single = estimateOfflineEconomyRates(save, world).buildings[0]!;
    save.settlement.fields = fields;
    const concurrent = estimateOfflineEconomyRates(save, world).buildings[0]!;
    expect(single.reason).toContain("saved owned grain plots (1)");
    expect(concurrent.reason).toContain("saved owned grain plots (9)");
    expect(concurrent.cycleSeconds).toBeLessThan(single.cycleSeconds - 60);
    expect(concurrent.cycleSeconds).toBeGreaterThanOrEqual(concurrent.workSeconds);
  });
  it("uses saved plantation geometry and does not repeat planting persistent hives", () => {
    const save = scenario(5), building = save.settlement.buildings[1]!;
    const unplanted = estimateOfflineEconomyRates(save, world).buildings[0]!;
    const point = { x: building.workerApproach.x + 2, z: building.workerApproach.z + 2 };
    save.settlement.fields = [{ id: Math.floor(point.z) * world.cellsX + Math.floor(point.x), owner: building.uid,
      kind: "vine", ...point, state: "ripe", progress: 1, step: 0 }];
    const planted = estimateOfflineEconomyRates(save, world).buildings[0]!;
    expect(planted.workerTravelSeconds).toBeLessThan(unplanted.workerTravelSeconds);
    expect(planted.reason).toContain("saved owned crop/pile geometry");
    save.settlement.playerNation = "viking";
    const persistent = estimateOfflineEconomyRates(save, world).buildings[0]!;
    expect(persistent.workSeconds).toBe(planted.workSeconds / 2);
    expect(persistent.reason).toContain("regrow without a repeated planting visit");
  });
  it("requests real recipe input buffers without treating finite source tokens as delivery demand", () => {
    const save = scenario(33, 23, 12, 27), charcoal = save.settlement.buildings[4]!;
    save.settlement.fields = [{ id: 78, owner: charcoal.uid, kind: "charcoal",
      x: charcoal.workerApproach.x + 2, z: charcoal.workerApproach.z + 2,
      state: "stubble", progress: 0, step: 0 }];
    const result = estimateOfflineEconomyRates(save, world);
    expect(result.jobs[0]!.inputTargets).toEqual({ logs: 2 });
    expect(result.jobs[1]!.inputTargets).toEqual({ grain: 2, water: 2 });
    expect(result.jobs[2]!.inputTargets).toEqual({ fish: 2, meat: 2, bread: 2 });
    // The grouped pile pays six real log deliveries atomically.
    expect(result.jobs[3]!.inputTargets).toEqual({ logs: 6 });
  });
  it("reports unsupported orders, paused and unstaffed buildings", () => {
    const save = scenario(24, 33, 35, 26, 1);
    save.settlement.buildings[2]!.handcartMode = true;
    save.settlement.buildings[3]!.productionPaused = true;
    save.settlement.buildings[4]!.worker = undefined;
    const result = estimateOfflineEconomyRates(save, world);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]!.outputSequence!.length).toBeGreaterThan(0);
    expect(result.unsupported.map(row => row.reason)).toEqual([
      "handcart orders require detailed simulation",
      "production paused", "unstaffed", "service consumption omitted"
    ]);
  });
  it("rejects unreachable storage and does not assume a carrier when no settlers are available", () => {
    const save = scenario(33);
    save.settlement.roads = [];
    expect(estimateOfflineEconomyRates(save, world).unsupported[0]!.reason).toContain("road-connected");
    const noCarriers = scenario(33);
    noCarriers.settlement.settlers = 0;
    noCarriers.settlement.actors = [];
    expect(estimateOfflineEconomyRates(noCarriers, world).unsupported[0]!.reason).toContain("no saved carrier");
  });
});

describe("flax, cloth and sea-ship offline guards", () => {
  it("models flax growth and the weaver's two-fibre cloth cycle", () => {
    const save = scenario(60, 61);
    save.settlement.fields = [{ id: 123, kind: "flax", owner: 100, progress: .5, state: "growing", step: 0,
      x: save.settlement.buildings[1]!.access.x + 1.5, z: save.settlement.buildings[1]!.access.z }];
    const result = estimateOfflineEconomyRates(save, world);
    expect(result.jobs[0]).toMatchObject({ inputs: {}, outputs: { flax: 1 } });
    expect(result.buildings[0]!.reason).toContain("saved owned flax plots");
    expect(result.jobs[1]).toMatchObject({ inputs: { flax: 2 }, outputs: { cloth: 1 } });
    const job = result.jobs[1]!;
    const completed = runOfflineEconomyEvents({ horizonTicks: job.cycleTicks * 3, jobs: [job],
      islands: [{ islandId: "home", stock: { flax: 4 } }] });
    expect(completed.completedCycles[job.uid]).toBe(2);
    expect(completed.islands[0]!.produced.cloth).toBe(2);
  });

  it("never turns a sea-ship shipyard into an offline boat job", () => {
    const save = scenario(36);
    save.settlement.naval = { modes: [[100, "ships"]], sites: [], active: [] } as never;
    const result = estimateOfflineEconomyRates(save, world);
    expect(result.jobs).toEqual([]);
    expect(result.unsupported).toEqual([{ uid: 100, reason: expect.stringContaining("sea-ship construction") }]);
  });
});
