import { STARTER_STOCK } from "@shared/catalog/balance";
import { expect, it, vi } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { START_SETTLERS } from "../src/shared/balance/population";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";
const fixture = () => {
  const size = 64,
    world = {
      cellsX: size,
      cellsZ: size,
      start: { x: 8, z: 8 },
      heights: new Float32Array((size + 1) ** 2),
      blocking: new Uint8Array(size ** 2),
      walkCost: new Uint8Array(size ** 2).fill(10),
      buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
      oreAmount: new Uint8Array(size ** 2),
      mineZone: new Uint16Array(size ** 2),
      mineZones: [],
      props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array() }
    } as unknown as WorldData;
  const demolished = vi.fn();
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, {
    isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false
  });
  simulation = createSettlementSimulation({
    world,
    roads,
    initialStock: { ...STARTER_STOCK },
    onBuildingDemolished: demolished
  });
  const [w, d] = getBuildingDefinition(17).gridFootprint;
  const result = simulation.placeBuilding(17, 24 + w / 2, 8 + d / 2);
  expect(result.ok, result.reason).toBe(true);
  const building = result.building!;
  simulation.connectRoads(simulation.headquarters.access, building.access);
  const advance = (seconds: number) => {
    for (let i = 0; i < seconds * 10; i++) simulation.update(0.1);
  };
  return { world, simulation, building, advance, demolished };
};

it("returns displaced crews from the headquarters to HQ", () => {
  const { advance, building, simulation } = fixture();
  const [width, depth] = getBuildingDefinition(29).gridFootprint;
  const result = simulation.placeBuilding(29, 20 + width % 2 / 2, 22 + depth % 2 / 2);
  expect(result.ok, result.reason).toBe(true);
  const store = result.building!;
  store.construction = 1;
  store.required = {};
  store.inventory.hammer = 1;
  simulation.headquarters.inventory.hammer!--;
  simulation.connectRoads(simulation.headquarters.access, store.access);
  simulation.connectRoads(store.access, building.access);
  advance(3);
  const displaced = simulation.frames().filter(actor => actor.building === building.uid ||
    actor.delivery?.destination === building.uid);
  expect(displaced.length).toBeGreaterThan(0);
  expect(simulation.demolishBuilding(building.uid).ok).toBe(true);
  advance(150);
  for (const actor of displaced) {
    expect(actor.phase).toBe("retired");
    expect(actor.home).toBe(simulation.headquarters.uid);
    expect(actor.ware).toBeNull();
    expect(actor.tool).toBeUndefined();
  }
});
it("sends an outside worker to the closest completed storage, not the headquarters", () => {
  const { advance, building, simulation } = fixture();
  const [width, depth] = getBuildingDefinition(29).gridFootprint;
  const placed = simulation.placeBuilding(29, 20 + width % 2 / 2, 22 + depth % 2 / 2);
  expect(placed.ok, placed.reason).toBe(true);
  const store = placed.building!;
  Object.assign(store, { construction: 1, required: {} });
  expect(simulation.connectRoads(simulation.headquarters.access, store.access)).toBe(true);
  expect(simulation.connectRoads(store.access, building.access)).toBe(true);
  advance(1);
  const worker = simulation.frames().find(actor => actor.job === "Builder")!;
  expect(worker).toBeDefined();
  // The crew is outside, at the workplace, when the player demolishes it.
  Object.assign(worker, {
    building: building.uid, phase: "builderWork", visible: true, path: [], pathIndex: 0,
    x: building.access.x, z: building.access.z
  });
  const tool = worker.tool;
  const before = store.inventory.hammer ?? 0;
  expect(simulation.demolishBuilding(building.uid).ok).toBe(true);
  expect(worker.demolitionReturning).toBe(true);
  simulation.update(.05);
  expect(worker.home).toBe(store.uid);
  advance(120);
  expect(worker.phase).toBe("retired");
  expect(worker.home).toBe(store.uid);
  expect(worker.tool).toBeUndefined();
  expect(store.inventory.hammer ?? 0).toBe(before + (tool === "hammer" ? 1 : 0));
});

it("reroutes a carrier that is heading to a demolished building to the closest storage with its ware", () => {
  const { advance, building, simulation } = fixture();
  const [width, depth] = getBuildingDefinition(29).gridFootprint;
  const placed = simulation.placeBuilding(29, 20 + width % 2 / 2, 22 + depth % 2 / 2);
  expect(placed.ok, placed.reason).toBe(true);
  const store = placed.building!;
  Object.assign(store, { construction: 1, required: {} });
  expect(simulation.connectRoads(simulation.headquarters.access, store.access)).toBe(true);
  expect(simulation.connectRoads(store.access, building.access)).toBe(true);
  let carrier: ReturnType<typeof simulation.frames>[number] | undefined;
  for (let tick = 0; tick < 1200 && !carrier; tick++) {
    simulation.update(.05);
    carrier = simulation.frames().find(actor => actor.delivery?.destination === building.uid &&
      actor.ware !== null && actor.job === "Carrier");
  }
  expect(carrier).toBeDefined();
  Object.assign(carrier!, { x: building.access.x, z: building.access.z, visible: true });
  const ware = carrier!.ware!;
  const units = carrier!.wareUnits ?? 1;
  const before = store.inventory[ware] ?? 0;
  expect(simulation.demolishBuilding(building.uid).ok).toBe(true);
  expect(carrier!.delivery).toBeUndefined();
  simulation.update(.05);
  expect(carrier!.home).toBe(store.uid);
  advance(120);
  expect(carrier!.phase).toBe("retired");
  expect(carrier!.ware).toBeNull();
  expect(store.inventory[ware] ?? 0).toBe(before + units);
});

it("removes a plan, releases funding and cells, protects HQ and does not refund spent construction", () => {
  const { building, demolished, simulation, world } = fixture();
  building.input = { planks: 1 };
  simulation.headquarters.inventory.planks!--;
  building.constructionConsumed = { planks: 1 };
  simulation.headquarters.inventory.planks!--;
  const before = simulation.headquarters.inventory.planks!,
    revision = world.buildRevision!;
  expect(simulation.demolishBuilding(simulation.headquarters.uid).ok).toBe(false);
  expect(simulation.demolishBuilding(building.uid).ok).toBe(true);
  expect(simulation.headquarters.inventory.planks).toBe(before + 1);
  expect(simulation.isOccupied(building.x, building.z)).toBe(false);
  expect(world.buildRevision).toBe(revision + 1);
  expect(demolished).toHaveBeenCalledWith(building);
  expect(simulation.demolishBuilding(building.uid).ok).toBe(false);
  expect(simulation.placeBuilding(17, building.x, building.z).ok).toBe(true);
});
it("cancels genuine construction deliveries and returns cargo, tools and every settler physically", () => {
  const { advance, building, simulation } = fixture();
  const planks = simulation.headquarters.inventory.planks!,
    hammers = simulation.headquarters.inventory.hammer!;
  advance(2);
  expect(simulation.frames().some((a) => a.delivery?.destination === building.uid)).toBe(true);
  expect(simulation.frames().some((a) => a.job === "Builder")).toBe(true);
  const actors = simulation
    .frames()
    .filter((a) => a.building === building.uid || a.delivery?.destination === building.uid);
  expect(simulation.demolishBuilding(building.uid).ok).toBe(true);
  expect(actors.every((a) => a.demolitionReturning)).toBe(true);
  expect(simulation.snapshot().settlersInside).toBeLessThan(START_SETTLERS);
  advance(180);
  expect(actors.every((a) => a.phase === "retired" && !a.visible)).toBe(true);
  expect(simulation.snapshot().settlersInside).toBe(START_SETTLERS + simulation.settlerBirths());
  expect(simulation.headquarters.inventory.hammer).toBe(hammers);
  expect(simulation.headquarters.inventory.planks).toBe(planks);
  expect(simulation.frames().every((a) => !a.delivery)).toBe(true);
});
it("keeps the completed building's carried output on its returning worker until home", () => {
  const { advance, building, simulation } = fixture();
  building.construction = 1;
  building.required = {};
  advance(1);
  const worker = simulation
    .frames()
    .find((a) => a.building === building.uid && a.job === "Woodcutter")!;
  expect(worker).toBeDefined();
  worker.visible = true;
  worker.x = building.access.x;
  worker.z = building.access.z;
  worker.ware = "logs";
  worker.phase="outputPutdown";worker.stockBuilding=building.uid;
  building.output = { logs: 2 };
  const before = simulation.headquarters.inventory.logs ?? 0;
  expect(simulation.demolishBuilding(building.uid).ok).toBe(true);
  expect(worker.ware).toBe("logs");
  expect(worker.visible).toBe(true);
  expect(simulation.headquarters.inventory.logs).toBe(before + 2);
  advance(180);
  expect(simulation.headquarters.inventory.logs).toBe(before + 3);
  expect(worker.ware).toBeNull();
  expect(worker.tool).toBeUndefined();
});
