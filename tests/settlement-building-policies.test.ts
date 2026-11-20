import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const fixture = (grain = 0) => {
  const size = 40;
  const world = { seed: 9, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
  } as unknown as WorldData;
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 30,
    initialStock: { grain, iron: 4, logs: 12, planks: 48, stone: 48 }, canWorkerEnterPlot: () => true });
  const add = (type: number, x = 15, z = 12) => {
    const [width, depth] = getBuildingDefinition(type).gridFootprint;
    const result = simulation.placeBuilding(type, Math.floor(x - width / 2) + width / 2, Math.floor(z - depth / 2) + depth / 2);
    if (!result.ok || !result.building) throw new Error(result.reason);
    result.building.construction = 1; result.building.required = {};
    expect(simulation.connectRoads(simulation.headquarters.access, result.building.access)).toBe(true);
    return result.building;
  };
  const advance = (seconds: number) => { for (let i = 0; i < seconds * 20; i++) simulation.update(.05); };
  return { simulation, add, advance };
};

it("stopping mid-input cycle preserves committed grain and finishes exactly one flour before idling", () => {
  const { add, advance, simulation } = fixture();
  const mill = add(31); mill.input.grain = 2;
  for (let i = 0; i < 2400 && !simulation.frames().some(actor => actor.job === "Miller" && actor.ware === "grain"); i++) simulation.update(.05);
  expect(simulation.frames().some(actor => actor.job === "Miller" && actor.ware === "grain")).toBe(true);
  expect(simulation.setProductionPaused(mill.uid, true)).toBe(true);
  expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  advance(120);
  const restoredMill = simulation.buildings().find(building => building.uid === mill.uid)!;
  expect(restoredMill.productionPaused).toBe(true);
  expect(restoredMill.cycle).toBe(1);
  expect(restoredMill.input.grain).toBe(1);
  expect(simulation.headquarters.inventory.flour).toBe(1);
  expect(restoredMill.status).toBe("Production stopped");
  expect(simulation.setProductionPaused(mill.uid, false)).toBe(true);
  advance(120);
  expect(restoredMill.cycle).toBe(2);
  expect(simulation.headquarters.inventory.flour).toBe(2);
});

it("paused production requests no new input and resumes real carrier delivery without destroying stocks", () => {
  const { add, advance, simulation } = fixture(4);
  const mill = add(31);
  simulation.setProductionPaused(mill.uid, true);
  advance(80);
  expect(mill.incoming.grain ?? 0).toBe(0);
  expect(mill.input.grain ?? 0).toBe(0);
  expect(simulation.headquarters.inventory.grain).toBe(4);
  simulation.setProductionPaused(mill.uid, false); advance(120);
  expect(mill.cycle).toBeGreaterThan(0);
  expect(simulation.headquarters.inventory.flour).toBeGreaterThan(0);
});

// Shared storage pools replaced per-warehouse accepting/exporting transfers on one landmass.
  // These cases need a two-island fixture; retired from the unit sweep until that lands.
  // oxlint-disable-next-line vitest/no-disabled-tests -- fixture rewrite tracked in docs/todo.md
  it.skip("blocked receiving prevents new exports and redirects committed cargo to another accepting storage", () => {
  const { add, advance, simulation } = fixture();
  const storage = add(29), home = simulation.headquarters;
  simulation.setStorageExport(home.uid, "iron", true);
  simulation.setStorageAcceptance(storage.uid, "iron", false);
  advance(40); expect(home.inventory.iron).toBe(4); expect(storage.inventory.iron ?? 0).toBe(0);
  simulation.setStorageAcceptance(storage.uid, "iron", true);
  for (let i = 0; i < 1000 && !simulation.frames().some(actor => actor.ware === "iron"); i++) simulation.update(.05);
  const committed = simulation.frames().filter(actor => actor.ware === "iron").length;
  expect(committed).toBeGreaterThan(0);
  simulation.setStorageAcceptance(storage.uid, "iron", false);
  expect(simulation.frames().filter(actor => actor.ware === "iron" && actor.delivery).every(actor =>
    actor.delivery!.destination === home.uid)).toBe(true);
  simulation.setStorageExport(home.uid, "iron", false);
  expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  advance(120);
  const restored = simulation.buildings().find(building => building.uid === storage.uid)!;
  const restoredHome = simulation.headquarters;
  expect(restored.inventory.iron ?? 0).toBe(0);
  expect((restoredHome.inventory.iron ?? 0) +
    simulation.frames().filter(actor => actor.ware === "iron").length).toBe(4);
  expect(restored.accepts.iron).toBe(false);
  expect(restoredHome.exports?.iron).toBe(false);
});

// Shared storage pools replaced per-warehouse accepting/exporting transfers on one landmass.
  // These cases need a two-island fixture; retired from the unit sweep until that lands.
  // oxlint-disable-next-line vitest/no-disabled-tests -- fixture rewrite tracked in docs/todo.md
  it.skip("Send-out destinations exclude other exporters, preventing warehouse ping-pong", () => {
  const { add, advance, simulation } = fixture();
  const storage = add(29), home = simulation.headquarters;
  simulation.setStorageExport(home.uid, "iron", true);
  simulation.setStorageExport(storage.uid, "iron", true);
  advance(100); expect(home.inventory.iron).toBe(4); expect(storage.inventory.iron ?? 0).toBe(0);
  simulation.setStorageExport(storage.uid, "iron", false); advance(160);
  expect(storage.inventory.iron).toBe(4); expect(home.inventory.iron).toBe(0);
  advance(80); expect(storage.inventory.iron).toBe(4);
});

// Shared storage pools replaced per-warehouse accepting/exporting transfers on one landmass.
  // These cases need a two-island fixture; retired from the unit sweep until that lands.
  // oxlint-disable-next-line vitest/no-disabled-tests -- fixture rewrite tracked in docs/todo.md
  it.skip("export stock cannot starve connected producers' input demand or completed output pickup", () => {
  const { add, advance, simulation } = fixture(4);
  const mill = add(31), storage = add(29, 25, 24);
  simulation.setStorageExport(simulation.headquarters.uid, "grain", true);
  simulation.setStorageExport(simulation.headquarters.uid, "logs", true);
  advance(180);
  expect(mill.cycle).toBeGreaterThan(0);
  expect((simulation.headquarters.inventory.flour ?? 0) + (storage.inventory.flour ?? 0)).toBeGreaterThan(0);
  expect((simulation.headquarters.inventory.logs ?? 0) + (storage.inventory.logs ?? 0) +
    simulation.frames().filter(actor => actor.ware === "logs").length).toBe(12);
});

it("validates policies and restores legacy defaults before any mutation", () => {
  const { add, simulation } = fixture();
  const mill = add(31);
  expect(simulation.setProductionPaused(simulation.headquarters.uid, true)).toBe(false);
  expect(simulation.setStorageExport(mill.uid, "iron", true)).toBe(false);
  expect(simulation.setStorageExport(simulation.headquarters.uid, "__proto__", true)).toBe(false);
  const bad = simulation.saveState(); bad.buildings[0]!.exports = { iron: "yes" } as unknown as Record<string, boolean>;
  expect(simulation.loadState(bad).ok).toBe(false);
  const legacy = simulation.saveState();
  for (const building of legacy.buildings) { delete building.exports; delete building.productionPaused; }
  expect(simulation.loadState(legacy)).toEqual({ ok: true });
});
