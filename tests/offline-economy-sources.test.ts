import { describe, expect, it } from "vitest";

import { type OfflineEconomyJob, runOfflineEconomyEvents } from "../src/app/settlement/offline-economy-events";
import { prepareOfflineEconomySources } from "../src/app/settlement/offline-economy-sources";
import { createTreeGrowth } from "../src/render-common/growth/tree-growth";
import { createAnimalManager } from "../src/render-common/wildlife/animal-manager";
import { validateAnimalSave } from "../src/render-common/wildlife/manager/animal-save";
import { createIslandNav } from "../src/render-common/wildlife/nav/island-nav";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { BLOCKING, ORE, PROP, PROP_REMOVED } from "../src/shared/world/world-data";
import { huntingWorld } from "./helpers/hunting-world";

const fixture = () => {
  const world = huntingWorld(), roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({ world, roads });
  const save = { settlement: simulation.saveState() } as GameSaveV1;
  const building = (uid: number, typeId: number, x = 20, z = 20): SettlementBuilding => {
    const value = { ...save.settlement.buildings[0]!, uid, typeId, x, z,
      width: 2, depth: 2, access: { x, z: z + 2 }, worker: uid + 100, construction: 1 };
    save.settlement.buildings.push(value); return value;
  };
  const tree = (id: number, x = 24, z = 20, type: number = PROP.coniferTree) => {
    world.props.count = Math.max(world.props.count, id + 1);
    world.props.types[id] = type; world.props.x[id] = x; world.props.z[id] = z;
    world.props.y[id] = 2; world.props.scale[id] = 1;
  };
  const job = (key: string): OfflineEconomyJob => ({ uid: key, islandId: "home", cycleTicks: 1,
    inputs: { [key]: 1 }, outputs: { logs: 1 } });
  return { world, save, building, tree, job };
};

describe("offline economic finite sources", () => {
  it("claims shared mature trees once, enforces species, and removes harvested props", () => {
    const f = fixture(); f.building(1, 17); f.building(2, 17); f.building(3, 42);
    f.tree(0); f.tree(1, 25, 20, PROP.hardwoodTree);
    const sources = prepareOfflineEconomySources(f.save, f.world,
      [f.job("~tree:17"), f.job("~tree:17"), f.job("~tree:42")]);
    expect(sources.stock).toEqual({ "~tree:17": 1, "~tree:42": 1 });
    sources.apply({ "~tree:17": 1, "~tree:42": 1 });
    expect(Array.from(f.world.props.types.slice(0, 2))).toEqual([PROP_REMOVED, PROP_REMOVED]);
    expect(f.save.settlement.resourceAmounts).toEqual(expect.arrayContaining([["tree:0", 0], ["tree:1", 0]]));
    expect(() => sources.apply({})).toThrow("already applied");
  });
  it("withholds targeted, growing, out-of-range and disconnected trees", () => {
    const f = fixture(); f.building(1, 17);
    f.tree(0); f.tree(1, 25); f.tree(2, 50); f.tree(3, 26);
    f.save.settlement.reservations.push("tree:0");
    f.save.runtime = { growth: { planted: [[1, 0]], grown: [] } };
    for (let z = 0; z < f.world.cellsZ; z++) f.world.walkCost[z * f.world.cellsX + 22] = 0;
    const sources = prepareOfflineEconomySources(f.save, f.world, [f.job("~tree:17")]);
    expect(sources.stock["~tree:17"]).toBe(0);
    sources.apply({});
    expect(f.world.props.types[0]).toBe(PROP.coniferTree);
  });
  it("validates all source debits before mutating any source", () => {
    const f = fixture(); f.building(1, 17); f.tree(0);
    const sources = prepareOfflineEconomySources(f.save, f.world, [f.job("~tree:17")]);
    expect(() => sources.apply({ "~tree:17": 1, "~ore:99": 1 })).toThrow("overdraw");
    expect(f.world.props.types[0]).toBe(PROP.coniferTree);
    sources.apply({ "~tree:17": 1 });
    expect(f.world.props.types[0]).toBe(PROP_REMOVED);
  });
  it("removes harvested tree identities from saved growth and felling ledgers", () => {
    const f = fixture(); f.building(1, 17); f.tree(0);
    const runtime = { growth: { trees: [0], grown: [0], jobPlanted: [0], planted: [[0, 0]], removed: [[0, false]] },
      felling: { fallYaws: [[0, 0]], controller: { fellings: [] } } };
    f.save.runtime = runtime;
    const sources = prepareOfflineEconomySources(f.save, f.world, [f.job("~tree:17")]);
    expect(sources.stock["~tree:17"]).toBe(1);
    sources.apply({ "~tree:17": 1 });
    expect(runtime).toEqual({ growth: { trees: [], grown: [], jobPlanted: [], planted: [], removed: [] },
      felling: { fallYaws: [], controller: { fellings: [] } } });
  });
  it("leaves the saved wildlife untouched: its region counters derive from the world on load", () => {
    const f = fixture(); f.building(1, 17);
    const trees = Array.from({ length: 10 }, (_, id) => id);
    for (const id of trees) f.tree(id, 24 + id % 5, 20 + Math.floor(id / 5));
    const animals = createAnimalManager(f.world, createIslandNav(f.world, [])).saveState();
    const oldAnimals = structuredClone(animals);
    const runtime = { animals,
      growth: { trees, grown: [], jobPlanted: [], planted: [], removed: [] },
      felling: { fallYaws: [], controller: { fellings: [] } } };
    f.save.runtime = runtime;
    const sources = prepareOfflineEconomySources(f.save, f.world, [f.job("~tree:17")]);
    sources.apply({ "~tree:17": 2 });
    expect(f.world.props.types[0]).toBe(PROP_REMOVED);
    expect(animals).toEqual(oldAnimals);
    expect(() => validateAnimalSave(animals)).not.toThrow();
  });
  it("retains ore for the original paid mine cycle and decrements actual ore cells", () => {
    const f = fixture(), mine = f.building(1, 11);
    const cell = 19 * f.world.cellsX + 19;
    f.world.mineZones = [{ id: 1, ore: ORE.coal, cellCount: 1, centreX: 19, centreZ: 19,
      richness: 1, surveyed: true }];
    f.world.mineZone[cell] = 1; f.world.oreAmount[cell] = 4;
    f.save.settlement.actors.push({ building: mine.uid, productionSeconds: 8 } as typeof f.save.settlement.actors[number]);
    const sources = prepareOfflineEconomySources(f.save, f.world, [f.job("~ore:1")]);
    expect(sources.stock["~ore:1"]).toBe(3);
    sources.apply({ "~ore:1": 3 });
    expect(f.world.oreAmount[cell]).toBe(1);
  });
  it("shares finite material deposits across overlapping quarries and records depletion", () => {
    const f = fixture(); f.building(1, 43); f.building(2, 43);
    f.save.settlement.marbleDeposits = [{ id: 0, x: 24, z: 20, remaining: 3, material: "marble" }];
    const mining = f.job("~source:1");
    const sources = prepareOfflineEconomySources(f.save, f.world,
      [mining, f.job("~source:2")]);
    expect(sources.stock).toEqual({ "~source:1": 3, "~source:2": 0 });
    sources.apply({ "~source:1": 3 });
    expect(f.save.settlement.marbleDeposits[0]!.remaining).toBe(0);
    expect(f.save.settlement.stoneRespawns).toEqual([{ id: 0, kind: "deposit", restSeconds: 0 }]);
  });
  it("withholds unknown wildlife and unknown fishing sites", () => {
    const f = fixture(); f.building(1, 22); f.building(2, 18);
    const sources = prepareOfflineEconomySources(f.save, f.world,
      [f.job("~source:1"), f.job("~source:2")]);
    expect(sources.stock).toEqual({ "~source:1": 0, "~source:2": 0 });
    expect(sources.notes.some(note => note.includes("wildlife"))).toBe(true);
  });
  it("uses the actual quarry ledger and queues a depleted boulder for later respawn", () => {
    const f = fixture(); f.building(1, 19); f.building(2, 19);
    f.tree(0, 24, 20, PROP.largeRock);
    f.save.runtime = { stone: { props: [[0, 2]], formations: [], seams: [], nextId: -1 } };
    const mining = f.job("~source:1");
    const sources = prepareOfflineEconomySources(f.save, f.world, [mining, f.job("~source:2")]);
    expect(sources.stock["~source:1"]).toBe(2);
    expect(sources.stock["~source:2"]).toBe(0);
    const result = runOfflineEconomyEvents({ horizonTicks: 2, jobs: [mining],
      islands: [{ islandId: "home", stock: sources.stock, capacities: sources.capacities }],
      onCompleted: sources.onCompleted });
    sources.apply(result.islands[0]!.consumed, result.islands[0]!.stock, result.islands[0]!.produced);
    expect(f.world.props.types[0]).toBe(PROP_REMOVED);
    expect(f.save.runtime).toMatchObject({ stone: { props: [[0, 0]] } });
    expect(f.save.settlement.stoneRespawns).toEqual([{ kind: "prop", id: 0, restSeconds: 0 }]);
    expect(f.save.settlement.integrity?.timers).toBe(1);
  });
  it("preserves the original paid fishing catch and shares its saved site", () => {
    const f = fixture(); f.building(1, 18); f.building(2, 18);
    f.world.waterSurface.fill(0); f.world.waterDepth.fill(2);
    for (const z of [20, 21]) for (const x of [24, 25]) f.world.heights[z * (f.world.cellsX + 1) + x] = -2;
    f.world.blocking[20 * f.world.cellsX + 24] = BLOCKING.water;
    const target = { id: 9, kind: "fish" as const, x: 24.5, z: 20.5, approach: { x: 23.5, z: 20.5 } };
    f.save.settlement.actors.push({ target } as typeof f.save.settlement.actors[number]);
    f.save.settlement.resourceAmounts = [["fish:9", 4]];
    const sources = prepareOfflineEconomySources(f.save, f.world,
      [f.job("~source:1"), f.job("~source:2")]);
    expect(sources.stock).toEqual({ "~source:1": 3, "~source:2": 0 });
    sources.apply({ "~source:1": 2 });
    expect(f.save.settlement.resourceAmounts).toEqual([["fish:9", 2]]);
  });
  it("renews a finite quarry only after exhaustion plus the authored rest and applies final physical stock", () => {
    const f = fixture(); f.building(1, 19); f.tree(0, 24, 20, PROP.largeRock);
    f.save.runtime = { stone: { props: [[0, 2]], formations: [], seams: [], nextId: -1 } };
    const mining = { ...f.job("~source:1"), endTick: 300_003 };
    const sources = prepareOfflineEconomySources(f.save, f.world, [mining]);
    expect(sources.capacities).toMatchObject({ "~source:1": 6 });
    expect(sources.jobs).toHaveLength(1);
    const result = runOfflineEconomyEvents({ horizonTicks: 300_003,
      jobs: [mining, { ...sources.jobs[0]!, endTick: 300_003 }],
      islands: [{ islandId: "home", stock: sources.stock, capacities: sources.capacities }],
      onCompleted: sources.onCompleted });
    const ledger = result.islands[0]!;
    expect(ledger.produced.logs).toBe(3);
    expect(ledger.produced["~source:1"]).toBe(6);
    expect(ledger.stock["~source:1"]).toBe(5);
    sources.apply(ledger.consumed, ledger.stock, ledger.produced);
    expect(f.save.runtime).toMatchObject({ stone: { props: [[0, 5]] } });
    expect(f.world.props.types[0]).toBe(PROP.largeRock);
    expect(f.save.settlement.stoneRespawns ?? []).toEqual([]);
  });
  it("withholds quarry renewal for a source still reserved by the original worker", () => {
    const f = fixture(); f.building(1, 19); f.tree(0, 24, 20, PROP.largeRock);
    f.save.runtime = { stone: { props: [[0, 6]], formations: [], seams: [], nextId: -1 } };
    f.save.settlement.reservations.push("stone:0");
    const sources = prepareOfflineEconomySources(f.save, f.world, [f.job("~source:1")]);
    expect(sources.stock["~source:1"]).toBe(5);
    expect(sources.jobs).toEqual([]);
    expect(sources.capacities["~source:1"]).toBe(6);
  });
  it("requires a consistent final source balance before applying a renewal", () => {
    const f = fixture(); f.building(1, 43);
    f.save.settlement.marbleDeposits = [{ id: 0, x: 24, z: 20, remaining: 3, material: "marble" }];
    const sources = prepareOfflineEconomySources(f.save, f.world, [f.job("~source:1")]);
    expect(() => sources.apply({ "~source:1": 4 }, { "~source:1": 48 }, { "~source:1": 48 }))
      .toThrow("renewal balance");
    expect(f.save.settlement.marbleDeposits[0]!.remaining).toBe(3);
    sources.apply({ "~source:1": 4 }, { "~source:1": 47 }, { "~source:1": 48 });
    expect(f.save.settlement.marbleDeposits[0]!.remaining).toBe(47);
  });
  it("retains an original work source in full while other material deposits replenish", () => {
    const f = fixture(); f.building(1, 43);
    f.save.settlement.marbleDeposits = [
      { id: 0, x: 24, z: 20, remaining: 48, material: "marble" },
      { id: 1, x: 26, z: 20, remaining: 3, material: "marble" }
    ];
    f.save.settlement.reservations.push("stone:-3000000");
    const sources = prepareOfflineEconomySources(f.save, f.world, [f.job("~source:1")]);
    expect(sources.stock["~source:1"]).toBe(3);
    expect(sources.capacities["~source:1"]).toBe(48);
    sources.apply({ "~source:1": 4 }, { "~source:1": 47 }, { "~source:1": 48 });
    expect(f.save.settlement.marbleDeposits.map(source => source.remaining)).toEqual([48, 47]);
  });

  it("makes a known growing tree available once at maturity and preserves unharvested growth", () => {
    const f = fixture(); f.building(1, 17); f.tree(0);
    const growth = createTreeGrowth([], 12, () => true);
    growth.update(100); growth.plant(0, 100);
    const runtime = { growth: growth.saveState(), felling: { fallYaws: [], controller: { fellings: [] } } };
    f.save.runtime = runtime;
    const sources = prepareOfflineEconomySources(f.save, f.world, [f.job("~tree:17")], 25);
    expect(sources.stock["~tree:17"]).toBe(0);
    expect(sources.jobs).toHaveLength(1);
    const before = runOfflineEconomyEvents({ horizonTicks: 20_000, jobs: sources.jobs,
      islands: [{ islandId: "home", stock: sources.stock }] });
    expect(before.islands[0]!.stock["~tree:17"]).toBe(0);
    const result = runOfflineEconomyEvents({ horizonTicks: 25_000, jobs: sources.jobs,
      islands: [{ islandId: "home", stock: sources.stock }] });
    const ledger = result.islands[0]!;
    expect(ledger.produced).toEqual({ "~tree:17": 1 });
    sources.apply(ledger.consumed, ledger.stock, ledger.produced);
    expect(f.world.props.types[0]).toBe(PROP.coniferTree);
    expect(runtime.growth.now).toBe(125);
    expect(runtime.growth.planted).toEqual([]);
    expect(runtime.growth.grown).toEqual([0]);
  });

  it("harvests matured source identities in time order without cutting a later tree early", () => {
    const f = fixture(); f.building(1, 17); f.tree(0); f.tree(1, 25);
    const growth = createTreeGrowth([], 12, () => true);
    growth.update(100); growth.plant(0, 90); growth.plant(1, 110);
    const runtime = { growth: growth.saveState(), felling: { fallYaws: [], controller: { fellings: [] } } };
    f.save.runtime = runtime;
    const worker = { ...f.job("~tree:17"), cycleTicks: 1000, endTick: 11_001 };
    const sources = prepareOfflineEconomySources(f.save, f.world, [worker], 40);
    const result = runOfflineEconomyEvents({ horizonTicks: 40_000, jobs: [worker, ...sources.jobs],
      islands: [{ islandId: "home", stock: sources.stock }] });
    const ledger = result.islands[0]!;
    expect(ledger.produced).toEqual({ "~tree:17": 2, logs: 1 });
    sources.apply(ledger.consumed, ledger.stock, ledger.produced);
    expect(f.world.props.types[0]).toBe(PROP.coniferTree);
    expect(f.world.props.types[1]).toBe(PROP_REMOVED);
    expect(runtime.growth.grown).toEqual([0]);
    expect(runtime.growth.planted).toEqual([]);
  });

  it("rejects invented maturation tokens before changing a tree or its growth clock", () => {
    const f = fixture(); f.building(1, 17); f.tree(0);
    const growth = createTreeGrowth([], 12, () => true);
    growth.update(100); growth.setSpeed(2); growth.plant(0, 100);
    const runtime = { growth: growth.saveState(), felling: { fallYaws: [], controller: { fellings: [] } } };
    f.save.runtime = runtime;
    const sources = prepareOfflineEconomySources(f.save, f.world, [f.job("~tree:17")], 15);
    expect(sources.jobs[0]!.firstTick).toBe(10_000);
    expect(() => sources.apply({ "~tree:17": 2 }, { "~tree:17": 0 }, { "~tree:17": 2 }))
      .toThrow("maturation balance");
    expect(f.world.props.types[0]).toBe(PROP.coniferTree);
    expect(runtime.growth.now).toBe(100);
    expect(() => prepareOfflineEconomySources(f.save, f.world, [], -1)).toThrow("source horizon");
  });

  it("excludes saved work targets while maturing harvested-tree habitat through the real growth helper", () => {
    const f = fixture(); f.building(1, 17);
    for (let id = 0; id < 10; id++) f.tree(id, 24 + id % 5, 20 + Math.floor(id / 5));
    const animals = createAnimalManager(f.world, createIslandNav(f.world, [])).saveState();
    const oldAnimals = structuredClone(animals);
    const growth = createTreeGrowth([], 12, () => true);
    growth.update(100);
    for (let id = 0; id < 10; id++) growth.plant(id, id < 2 ? 110 : 0);
    const runtime = { animals, growth: growth.saveState(), felling: { fallYaws: [], controller: { fellings: [] } } };
    f.save.runtime = runtime; f.save.settlement.reservations.push("tree:1");
    const worker = { ...f.job("~tree:17"), cycleTicks: 1000, endTick: 15_000 };
    const sources = prepareOfflineEconomySources(f.save, f.world, [worker], 15);
    expect(sources.jobs).toHaveLength(1);
    const result = runOfflineEconomyEvents({ horizonTicks: 15_000, jobs: [worker, ...sources.jobs],
      islands: [{ islandId: "home", stock: sources.stock }] });
    const ledger = result.islands[0]!;
    sources.apply(ledger.consumed, ledger.stock, ledger.produced);
    expect(f.world.props.types[0]).toBe(PROP_REMOVED);
    expect(f.world.props.types[1]).toBe(PROP.coniferTree);
    expect(runtime.growth.grown).toEqual([1]);
    expect(animals).toEqual(oldAnimals);
    expect(() => validateAnimalSave(animals)).not.toThrow();
  });

  const forestry = (count = 1) => {
    const f = fixture(); f.building(1, 17); f.building(2, 20);
    for (let id = 0; id < count; id++) f.tree(id, 24 + id * 5, 20);
    const growth = createTreeGrowth([], 12, () => true); growth.update(100);
    const runtime = { growth: growth.saveState(), felling: { fallYaws: [], controller: { fellings: [] } } };
    f.save.runtime = runtime;
    const worker = { ...f.job("~tree:17"), uid: "building:1", cycleTicks: 1000 };
    return { ...f, runtime, worker };
  };

  it("reuses original harvested sites only after each generation's nursery work and full growth", () => {
    const f = forestry(2), initialRandom = f.save.settlement.plantingRandomState;
    const sources = prepareOfflineEconomySources(f.save, f.world, [f.worker], 500);
    expect(sources.jobs.length).toBeGreaterThan(7);
    expect(sources.jobs.filter(job => job.uid.startsWith("plant:"))).toHaveLength(1);
    expect(sources.jobs.some(job => job.uid.includes("fresh:"))).toBe(true);
    expect(f.world.props.count).toBe(2);
    expect(f.save.settlement.plantingRandomState).toBe(initialRandom);
    const run = (horizonTicks: number) => runOfflineEconomyEvents({ horizonTicks,
      jobs: [f.worker, ...sources.jobs].map(job => ({ ...job, endTick: horizonTicks })),
      islands: [{ islandId: "home", stock: sources.stock }] });
    const planting = sources.jobs.find(job => job.uid.startsWith("plant:"))!.sourceChoices!.choices;
    const growth = sources.jobs.find(job => job.uid.startsWith("regrow:"))!;
    const beforeMaturity = 1000 + Math.min(...planting.map(choice => choice.cycleTicks!)) + growth.cycleTicks - 1;
    expect(run(beforeMaturity).islands[0]!.produced.logs).toBe(2);
    const ledger = run(500_000).islands[0]!;
    expect(ledger.produced.logs).toBeGreaterThan(4);
    expect(ledger.produced["~tree:17"]).toBeGreaterThan(2);
    const planted = Object.entries(ledger.produced).filter(([key]) => key.startsWith("~planted:"))
      .reduce((sum, [, count]) => sum + count, 0);
    sources.apply(ledger.consumed, ledger.stock, ledger.produced);
    expect(f.world.props.count).toBe(2 + planted);
    expect(Array.from(f.world.props.types.slice(0, f.world.props.count))
      .filter(type => type === PROP_REMOVED)).toHaveLength(ledger.produced.logs!);
    expect(f.save.settlement.plantingRandomState).not.toBe(initialRandom);
    expect(f.runtime.growth.now).toBe(600);
  });

  it("requires the actual stump before planting and leaves unperformed RNG and props untouched", () => {
    const f = forestry(2), initialRandom = f.save.settlement.plantingRandomState;
    const sources = prepareOfflineEconomySources(f.save, f.world, [{ ...f.worker, endTick: 0 }], 500);
    const ledger = runOfflineEconomyEvents({ horizonTicks: 500_000,
      jobs: [{ ...f.worker, endTick: 0 }, ...sources.jobs.map(job => ({ ...job, endTick: 500_000 }))],
      islands: [{ islandId: "home", stock: sources.stock }] }).islands[0]!;
    expect(ledger.produced["~tree:17"] ?? 0).toBe(0);
    sources.apply(ledger.consumed, ledger.stock, ledger.produced);
    expect(f.world.props.count).toBe(2);
    expect(f.save.settlement.plantingRandomState).toBe(initialRandom);
  });

  it("serializes a day of nursery generations without waking every future planting on each harvest", () => {
    const f = forestry(2);
    const sources = prepareOfflineEconomySources(f.save, f.world, [f.worker], 86_400);
    const planting = sources.jobs.filter(job => job.uid.startsWith("plant:"));
    expect(planting).toHaveLength(1);
    const result = runOfflineEconomyEvents({ horizonTicks: 86_400_000, maxEvents: 20_000,
      jobs: [f.worker, ...sources.jobs].map(job => ({ ...job, endTick: 86_400_000 })),
      islands: [{ islandId: "home", stock: sources.stock }] });
    expect(result.islands[0]!.produced.logs).toBeGreaterThan(100);
    expect(result.events).toBeLessThan(20 * sources.jobs.length);
  });

  it("preserves a completed, unharvested replant as a real mature prop and growth identity", () => {
    const f = forestry();
    const sources = prepareOfflineEconomySources(f.save, f.world, [f.worker], 300);
    const ledger = runOfflineEconomyEvents({ horizonTicks: 300_000,
      jobs: [{ ...f.worker, endTick: 1000 }, ...sources.jobs.map(job => ({ ...job, endTick: 300_000 }))],
      islands: [{ islandId: "home", stock: sources.stock }] }).islands[0]!;
    expect(ledger.stock["~tree:17"]).toBeGreaterThanOrEqual(1);
    sources.apply(ledger.consumed, ledger.stock, ledger.produced);
    expect(f.world.props.types[0]).toBe(PROP_REMOVED);
    expect(f.runtime.growth.jobPlanted.length).toBeGreaterThanOrEqual(1);
    expect(f.runtime.growth.grown.length).toBeGreaterThanOrEqual(1);
    const planted = f.runtime.growth.grown[0]!;
    expect(f.runtime.growth.jobPlanted).toContain(planted);
    expect(f.world.props.types[planted]).not.toBe(PROP_REMOVED);
    expect(f.world.props.x[planted]! % 1).toBeCloseTo(.5);
  });

  it("preserves a newly planted sapling that has not completed the authored growth delay", () => {
    const f = forestry();
    const sources = prepareOfflineEconomySources(f.save, f.world, [f.worker], 150);
    const ledger = runOfflineEconomyEvents({ horizonTicks: 100_000,
      jobs: [{ ...f.worker, endTick: 1000 }, ...sources.jobs.map(job => ({ ...job, endTick: 100_000 }))],
      islands: [{ islandId: "home", stock: sources.stock }] }).islands[0]!;
    expect(ledger.produced["~tree:17"] ?? 0).toBe(0);
    sources.apply(ledger.consumed, ledger.stock, ledger.produced);
    expect(f.runtime.growth.grown).toEqual([]);
    expect(f.runtime.growth.planted).toEqual([[1, 250]]);
    expect(f.runtime.growth.jobPlanted).toEqual([1]);
  });

  it("rejects invented replants atomically and excludes unavailable sites and competing cutters", () => {
    const f = forestry();
    const sources = prepareOfflineEconomySources(f.save, f.world, [f.worker], 300);
    expect(() => sources.apply({ "~tree:17": 2 }, { "~tree:17": 0 },
      { "~tree:17": 1, "~mature:0": 1 })).toThrow(/planting balance|token balance/);
    expect(f.world.props.count).toBe(1);
    expect(f.world.props.types[0]).not.toBe(PROP_REMOVED);
    const g = forestry();
    g.save.settlement.reservations.push(`plant:${20 * g.world.cellsX + 24}`);
    const blocked = prepareOfflineEconomySources(g.save, g.world, [g.worker], 300);
    expect(blocked.jobs.some(job => "~stump:0" in job.inputs)).toBe(false);
    const h = forestry();
    expect(prepareOfflineEconomySources(h.save, h.world, [h.worker,
      { ...h.worker, uid: "building:3" }], 300).jobs).toEqual([]);
  });

  it("reuses a real initial empty nursery site only after each prior harvest, bounded by the horizon", () => {
    const f = forestry(0);
    f.world.buildClass.fill(1); f.world.buildClass[20 * f.world.cellsX + 24] = 4;
    const sources = prepareOfflineEconomySources(f.save, f.world, [f.worker], 500);
    expect(sources.stock["~tree:17"]).toBe(0);
    expect(sources.jobs).toHaveLength(4);
    const run = (horizonTicks: number) => runOfflineEconomyEvents({ horizonTicks,
      jobs: [f.worker, ...sources.jobs].map(job => ({ ...job, endTick: horizonTicks })),
      islands: [{ islandId: "home", stock: sources.stock }] }).islands[0]!;
    const firstPlant = sources.jobs.find(job => job.uid.startsWith("plant:"))!;
    const grow = sources.jobs.find(job => job.uid.startsWith("regrow:"))!;
    expect(run(firstPlant.cycleTicks + grow.cycleTicks + f.worker.cycleTicks - 1).produced.logs ?? 0).toBe(0);
    expect(run(300_000).produced.logs).toBe(1);
    const ledger = run(500_000);
    expect(ledger.produced.logs).toBe(2);
    sources.apply(ledger.consumed, ledger.stock, ledger.produced);
    expect(f.world.props.count).toBe(3);
    expect(f.world.props.x[0]).toBe(24.5);
    expect(f.world.props.x[1]).toBe(24.5);
    expect(f.world.props.types[0]).toBe(PROP_REMOVED);
    expect(f.world.props.types[1]).toBe(PROP_REMOVED);
    expect(f.world.props.types[2]).not.toBe(PROP_REMOVED);
    expect(f.runtime.growth.planted).toEqual([[2, 600]]);
  });

  it("rejects nursery sites that need an unchosen neighboring original tree removed first", () => {
    const f = forestry(2); f.world.props.x[1] = 26;
    const sources = prepareOfflineEconomySources(f.save, f.world, [f.worker], 500);
    expect(sources.jobs.length).toBeGreaterThan(0);
    expect(sources.jobs.flatMap(job => Object.keys(job.inputs))).not.toContain("~stump:1");
  });

  it("stops later nursery generations while the previous planted tree remains unharvested", () => {
    const f = forestry(0);
    f.world.buildClass.fill(1); f.world.buildClass[20 * f.world.cellsX + 24] = 4;
    const sources = prepareOfflineEconomySources(f.save, f.world, [f.worker], 1000);
    const ledger = runOfflineEconomyEvents({ horizonTicks: 1_000_000,
      jobs: [{ ...f.worker, endTick: 185_334 },
        ...sources.jobs.map(job => ({ ...job, endTick: 1_000_000 }))],
      islands: [{ islandId: "home", stock: sources.stock }] }).islands[0]!;
    expect(ledger.produced.logs).toBe(1);
    expect(ledger.produced["~tree:17"]).toBe(2);
    expect(ledger.stock["~tree:17"]).toBeGreaterThanOrEqual(1);
    sources.apply(ledger.consumed, ledger.stock, ledger.produced);
    expect(f.world.props.count).toBe(2);
    expect(f.world.props.types[0]).toBe(PROP_REMOVED);
    expect(f.world.props.types[1]).not.toBe(PROP_REMOVED);
    expect(f.runtime.growth.grown).toEqual([1]);
  });

  it("chooses a nearby mature nursery tree before a farther original and applies exact identity debits", () => {
    const f = forestry(2), cutter = f.save.settlement.buildings.find(building => building.uid === 1)!;
    cutter.workerApproach = { x: 15, z: 20 };
    f.world.buildCap.fill(1); f.world.buildClass.fill(1);
    f.world.waterDepth.fill(0); f.world.coastDistance.fill(10);
    const fresh = 20 * f.world.cellsX + 14;
    f.world.buildCap[fresh] = 4; f.world.buildClass[fresh] = 4;
    f.worker.cycleTicks = 200_000;
    const sources = prepareOfflineEconomySources(f.save, f.world, [f.worker], 400);
    expect(f.worker.sourceChoices).toBeDefined();
    expect(f.worker.outputSequence).toBeUndefined();
    expect(sources.treeIdsByToken).toEqual({ "~identity:tree:0": 0, "~identity:tree:1": 1 });
    const result = runOfflineEconomyEvents({ horizonTicks: 400_000,
      jobs: [f.worker, ...sources.jobs].map(job => ({ ...job, endTick: 400_000 })),
      islands: [{ islandId: "home", stock: sources.stock }] });
    const ledger = result.islands[0]!;
    expect(ledger.produced.logs).toBe(2);
    expect(ledger.consumed["~identity:tree:0"]).toBe(1);
    expect(ledger.consumed["~identity:tree:1"] ?? 0).toBe(0);
    expect(ledger.consumed[`~mature:fresh:${fresh}`]).toBe(1);
    sources.apply(ledger.consumed, ledger.stock, ledger.produced);
    expect(f.world.props.types[0]).toBe(PROP_REMOVED);
    expect(f.world.props.types[1]).toBe(PROP.coniferTree);
    expect(f.world.props.types[2]).toBe(PROP_REMOVED);
  });

  it("rejects generic tree consumption without its exact identity before mutating habitat", () => {
    const f = forestry(), sources = prepareOfflineEconomySources(f.save, f.world, [f.worker], 300);
    expect(() => sources.apply({ "~tree:17": 1 })).toThrow("identity balance");
    expect(f.world.props.types[0]).toBe(PROP.coniferTree);
    expect(f.runtime.growth.now).toBe(100);
  });
});
