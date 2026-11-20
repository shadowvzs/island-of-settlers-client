import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { ARMORY_OUTPUTS } from "../src/shared/settlement/armory-orders";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const fixture = (typeId = 24) => {
  const size = 40;
  const world = {
    seed: 9, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
  } as unknown as WorldData;
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialStock: { hammer: 1, tongs: 1, planks: 20, stone: 20 }, canWorkerEnterPlot: () => true });
  const result = simulation.placeBuilding(typeId, 15 + getBuildingDefinition(typeId).gridFootprint[0] % 2 / 2,
    12 + getBuildingDefinition(typeId).gridFootprint[1] % 2 / 2);
  if (!result.ok || !result.building) throw new Error(result.reason);
  const building = result.building;
  building.construction = 1; building.foundationProgress = 1; building.required = {};
  building.input = typeId === 15 ? { leather: 2, cloth: 2 } : { iron: 20, coal: 20 };
  expect(roads.addRoad(simulation.headquarters.access, building.access)).toBe(true);
  for (const ware of ARMORY_OUTPUTS) simulation.setProductionOrder(building.uid, ware, 0);
  const advance = (seconds: number) => { for (let i = 0; i < seconds * 20; i++) simulation.update(.05); };
  const count = (ware: string) => simulation.buildings().reduce((total, b) =>
    total + (b.output[ware] ?? 0) + (b.inventory[ware] ?? 0), 0) +
    simulation.frames().filter(a => a.ware === ware).length;
  return { advance, building, count, simulation };
};

it("produces exact finite quantities for four weapon/shield wares without armor, then stops", () => {
  const { advance, building, count, simulation } = fixture();
  for (const ware of ARMORY_OUTPUTS) expect(simulation.setProductionOrder(building.uid, ware, 1)).toBe(true);
  expect(simulation.setProductionOrder(building.uid, "armor", 1)).toBe(false);
  advance(240);
  for (const ware of ARMORY_OUTPUTS) { expect(count(ware)).toBe(1); expect(building.productionOrders![ware]).toBe(0); }
  expect(count("armor")).toBe(0);
  expect(building.input).toEqual({ iron: 16, coal: 16 });
  advance(60);
  expect(building.input).toEqual({ iron: 16, coal: 16 });
  expect(building.status).toBe("Production orders complete");
});

it("locks in-flight output, saves orders and resumes; unlimited restarts a completed queue", () => {
  const { advance, building, count, simulation } = fixture();
  simulation.setProductionOrder(building.uid, "bow", 1);
  for (let i = 0; i < 3000 && !simulation.frames().some(a => a.phase === "work"); i++) simulation.update(.05);
  const worker = simulation.frames().find(a => a.building === building.uid)!;
  expect(worker.productionOutput).toBe("bow");
  simulation.setProductionOrder(building.uid, "bow", 0);
  simulation.setProductionOrder(building.uid, "shield", 1);
  const saved = JSON.parse(JSON.stringify(simulation.saveState()));
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  advance(180);
  expect(count("bow")).toBe(1); expect(count("shield")).toBe(1);
  expect(count("sword")).toBe(0);
  simulation.setProductionOrder(building.uid, "sword", null);
  advance(100);
  expect(count("sword")).toBeGreaterThan(1);
  expect(simulation.buildings().find(b => b.uid === building.uid)!.productionOrders!.sword).toBeNull();
});

it("rejects unsupported or corrupt orders atomically and keeps old saves compatible", () => {
  const { building, simulation } = fixture();
  for (const amount of [-1, 1.5, Infinity, 10000]) expect(simulation.setProductionOrder(building.uid, "bow", amount)).toBe(false);
  expect(simulation.setProductionOrder(0, "bow", 1)).toBe(false);
  expect(simulation.setProductionOrder(building.uid, "fish", 1)).toBe(false);
  const save = simulation.saveState();
  save.buildings.find(b => b.uid === building.uid)!.productionOrders = { bow: -1 };
  expect(simulation.loadState(save).ok).toBe(false);
  const legacy = simulation.saveState();
  delete legacy.buildings.find(b => b.uid === building.uid)!.productionOrders;
  expect(simulation.loadState(legacy)).toEqual({ ok: true });
});


it("keeps stored equipment/order data valid while starting no new armor cycles", () => {
  const { advance, building, count, simulation } = fixture();
  const state = simulation.saveState();
  const saved = state.buildings.find(candidate => candidate.uid === building.uid)!;
  saved.productionOrders = { armor: 1, bow: 1, shield: 0, sword: 0, axe: 0 };
  saved.output = { armor: 2 };
  expect(simulation.loadState(JSON.parse(JSON.stringify(state)))).toEqual({ ok: true });
  advance(180);
  expect(count("armor")).toBe(2);
  expect(count("bow")).toBe(1);
  expect(simulation.buildings().find(candidate => candidate.uid === building.uid)!.productionOrders!.armor).toBe(1);
});


it("keeps Leatherworks finite armor production and its paid work valid through save/reload", () => {
  const { advance, building, count, simulation } = fixture(15);
  for (let i = 0; i < 3000 && !simulation.frames().some(actor =>
    actor.building === building.uid && actor.phase === "work" && (actor.consumed?.leather ?? 0) > 0); i++) simulation.update(.05);
  const worker = simulation.frames().find(actor => actor.building === building.uid)!;
  expect(worker.consumed?.leather).toBe(1);
  expect(worker.consumed?.cloth).toBe(1);
  expect(simulation.loadState(JSON.parse(JSON.stringify(simulation.saveState())))).toEqual({ ok: true });
  advance(180);
  expect(count("armor")).toBe(2);
  const active = simulation.buildings().find(candidate => candidate.uid === building.uid)!;
  expect(active.input.leather ?? 0).toBe(0);
  expect(active.input.cloth ?? 0).toBe(0);
  advance(60);
  expect(count("armor")).toBe(2);
});

it("waits for cloth without consuming leather, then crafts only the fully paid armour", () => {
  const { advance, building, count, simulation } = fixture(15);
  building.input.cloth = 0;
  advance(90);
  expect(count("armor")).toBe(0);
  expect(building.input.leather).toBe(2);
  expect(simulation.frames().some(actor => actor.consumed?.leather)).toBe(false);
  building.input.cloth = 1;
  advance(180);
  expect(count("armor")).toBe(1);
  expect(building.input.leather).toBe(1);
  expect(building.input.cloth ?? 0).toBe(0);
  advance(60);
  expect(count("armor")).toBe(1);
});
