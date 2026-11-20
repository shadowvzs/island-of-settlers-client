import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";

import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

it("clears a warm harbour handoff and HQ queue after a live entrance-road interruption without reload", () => {
  const size = 64;
  const world = { seed: 4, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 25, z: 20 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(),
      scale: new Float32Array() } } as unknown as WorldData;
  for(let z=0;z<=size;z++)for(let x=50;x<=size;x++)world.heights[z*(size+1)+x]=-2;
  for(let z=0;z<size;z++)for(let x=50;x<size;x++) {
    const cell=z*size+x;world.blocking[cell]=1;world.walkCost[cell]=0;world.buildClass[cell]=0;
  }
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 100,
    initialStock: { planks: 100, stone: 100, hammer: 8 } });
  const sites = [];
  for (const [type, x, z] of [[35, 18, 26], [35, 25, 26], [35, 32, 26],
    [35, 18, 32], [35, 25, 32], [35, 32, 32]]) {
    const result = simulation.placeBuilding(type!, x!, z!);
    expect(result.ok, result.reason).toBe(true);
    sites.push(result.building!);
  }
  for (const site of sites)
    expect(simulation.connectRoads(simulation.headquarters.access, site.access)).toBe(true);
  // Populate the transient FIFO, parking, road-travel and stock-courtyard caches through actual work.
  for (let tick = 0; tick < 12000; tick++) simulation.update(.05);
  expect(simulation.buildings().every(building => building.construction === 1)).toBe(true);
  const result = simulation.placeBuilding(39, 44, 39);
  expect(result.ok, result.reason).toBe(true);
  const harbour = result.building!;
  expect(simulation.connectRoads(simulation.headquarters.access, harbour.access)).toBe(true);
  const committed = new Set<unknown>();
  let removed: ReturnType<typeof roads.segments>[number] | undefined;
  let removedAt = -1, restored = false, maximumStep = 0, handoffs = 0, elapsed = 0;
  for (let tick = 0; tick < 10000; tick++) {
    const before = new Map(simulation.frames().filter(actor => actor.visible)
      .map(actor => [actor.uid, { x: actor.x, z: actor.z }]));
    const transfer = simulation.frames().find(actor => actor.delivery?.destination === harbour.uid &&
      actor.phase === "deliveryTransfer");
    if (transfer && !removed) {
      removed = roads.segments().find(segment => [segment.start, segment.end].some(point =>
        Math.hypot(point.x - harbour.access.x, point.z - harbour.access.z) < .001));
      expect(removed).toBeDefined();
      expect(simulation.removeRoad(removed!.start, removed!.end)).toBe(true);
      expect(roads.route(simulation.headquarters.access, harbour.access)).toBeNull();
      removedAt = tick;
    }
    if (removed && !restored && tick - removedAt === 160) {
      expect(simulation.connectRoads(removed.start, removed.end)).toBe(true); restored = true;
    }
    simulation.update(.05); elapsed = (tick + 1) * .05;
    for (const actor of simulation.frames()) {
      const old = before.get(actor.uid);
      if (old && actor.visible)
        maximumStep = Math.max(maximumStep, Math.hypot(actor.x - old.x, actor.z - old.z));
      if (actor.delivery?.destination === harbour.uid) committed.add(actor.delivery);
      if (actor.phase === "deliveryTransfer" && actor.delivery?.destination === harbour.uid) handoffs++;
    }
    if (harbour.construction === 1 && tick > removedAt + 1800) break;
  }
  expect(removedAt).toBeGreaterThanOrEqual(0); expect(restored).toBe(true);
  expect(handoffs).toBeGreaterThan(0); expect(harbour.construction).toBe(1);
  expect(harbour.constructionConsumed).toEqual({ planks: 4, stone: 6 });
  expect(committed.size).toBeGreaterThanOrEqual(10);
  expect(simulation.frames().filter(actor => actor.delivery && committed.has(actor.delivery))).toEqual([]);
  expect(simulation.frames().filter(actor => actor.job === "Carrier" && !actor.ware && actor.visible &&
    Math.hypot(actor.x - harbour.x, actor.z - harbour.z) < 5)).toEqual([]);
  expect(maximumStep).toBeLessThanOrEqual(.071);
  expect(simulation.availableSettlers() + simulation.frames().filter(actor => actor.phase !== "retired").length).toBe(100 + simulation.settlerBirths());
  const conserved: Record<string, number> = {};
  for (const ware of ["planks", "stone"] as const) {
    const buildingTotal = simulation.buildings().reduce((sum, building) => sum +
      (building.inventory[ware] ?? 0) + (building.input[ware] ?? 0) + (building.output[ware] ?? 0) +
      (building.constructionConsumed?.[ware] ?? 0), 0);
    const travelling = simulation.frames().filter(actor => actor.ware === ware ||
      actor.delivery?.ware === ware && !actor.delivery.reserved && !actor.ware).length;
    conserved[ware] = buildingTotal + travelling;
    expect(conserved[ware]).toBe(100);
  }
  if (process.env.WARM_HARBOUR_REPORT) writeFileSync(process.env.WARM_HARBOUR_REPORT, JSON.stringify({
    status: "passed", test: "tests/settlement-warm-harbour-traffic.test.ts",
    scenario: "Six wells construct and run for 600 simulation seconds; then a harbour is constructed without reload",
    timestepSeconds: .05, warmupSeconds: 600, postPlacementSeconds: elapsed, reloads: 0,
    roadMutation: { removedAtSeconds: removedAt * .05, disconnectedDuringRealHandoff: true,
      restoredAfterSeconds: 8, restored, segment: removed },
    distinctHarbourDeliveryReceipts: committed.size, observedTransferTicks: handoffs,
    harbourConstruction: harbour.construction, harbourConsumed: harbour.constructionConsumed,
    outstandingTrackedDeliveries: simulation.frames().filter(actor => actor.delivery && committed.has(actor.delivery)).length,
    emptyVisibleCarriersWithin5TilesOfHarbour: simulation.frames().filter(actor => actor.job === "Carrier" &&
      !actor.ware && actor.visible && Math.hypot(actor.x - harbour.x, actor.z - harbour.z) < 5).length,
    maximumVisibleMovementPerTick: maximumStep,
    population: simulation.availableSettlers() + simulation.frames().filter(actor => actor.phase !== "retired").length,
    conservedWaresIncludingConsumed: conserved,
    limitations: ["Synthetic flat terrain, not the user's exact forest/map history",
      "Does not measure ready-door 0.5-second admission latency or claim all HQ queues are empty"]
  }, null, 2));
}, 30000);
