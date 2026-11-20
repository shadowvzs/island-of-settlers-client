import { expect, it } from "vitest";

import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, PROP, PROP_REMOVED, type WorldData } from "../src/shared/world/world-data";

it("finishes every mixed log/water delivery after a crowded save/load, preserving cargo and population", () => {
  const size = 64;
  const treeX = [46, 48, 50, 52].flatMap((x) => [x, x, x, x]);
  const treeZ = treeX.map((_, i) => 21 + (i % 4) * 2);
  const world = {
    seed: 3,
    cellsX: size,
    cellsZ: size,
    seaLevel: -1,
    start: { x: 25, z: 20 },
    heights: new Float32Array((size + 1) ** 2),
    blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10),
    buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2),
    mineZone: new Uint16Array(size ** 2),
    mineZones: [],
    props: {
      count: treeX.length,
      types: new Uint8Array(treeX.length).fill(PROP.broadleafTree),
      x: new Float32Array(treeX),
      z: new Float32Array(treeZ),
      scale: new Float32Array(treeX.length).fill(1)
    }
  } as unknown as WorldData;
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, {
    isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false
  });
  simulation = createSettlementSimulation({
    world,
    roads,
    initialSettlers: 100,
    initialStock: { planks: 300, stone: 300, logs: 100, hammer: 8, axe: 2 }
  });
  for (const [id, x, z] of [
    [35, 18, 26],
    [35, 25, 26],
    [35, 32, 26],
    [35, 18, 32],
    [35, 25, 32],
    [35, 32, 32],
    [17, 40, 26]
  ]) {
    const placed = simulation.placeBuilding(id!, x!, z!);
    expect(placed.ok, placed.reason).toBe(true);
  }
  for (const building of simulation.buildings().slice(1))
    expect(simulation.connectRoads(simulation.headquarters.access, building.access)).toBe(true);
  const loadedAt = new Map<number, number>();
  const completed = new Set<number>();
  let elapsed = 0,
    maximumAge = 0,
    maximumStep = 0;
  const advance = (seconds: number) => {
    for (let tick = 0; tick < seconds * 20; tick++) {
      const before = new Map(
        simulation
          .frames()
          .filter((a) => a.visible)
          .map((a) => [a.uid, { x: a.x, z: a.z }])
      );
      simulation.update(0.05);
      elapsed += 0.05;
      for (const actor of simulation.frames()) {
        const old = before.get(actor.uid);
        if (old && actor.visible)
          maximumStep = Math.max(maximumStep, Math.hypot(old.x - actor.x, old.z - actor.z));
        if (actor.job !== "Carrier") continue;
        const started = loadedAt.get(actor.uid);
        if (started !== undefined && !actor.ware) {
          maximumAge = Math.max(maximumAge, elapsed - started);
          completed.add(actor.uid);
          loadedAt.delete(actor.uid);
        }
        if (actor.ware && started === undefined) loadedAt.set(actor.uid, elapsed);
      }
      const alive = new Set(simulation.frames().map(actor => actor.uid));
      for (const [uid, started] of loadedAt) {
        if (alive.has(uid)) continue;
        maximumAge = Math.max(maximumAge, elapsed - started);
        completed.add(uid); loadedAt.delete(uid);
      }
    }
  };
  advance(600);
  expect(simulation.buildings().every((b) => b.construction === 1)).toBe(true);
  expect(simulation.headquarters.inventory.water).toBeGreaterThan(10);
  expect(simulation.headquarters.inventory.logs).toBeGreaterThan(100);
  // Stop NEW reservations; existing loaded and reserved jobs must still physically complete.
  simulation.setStorageAcceptance(simulation.headquarters.uid, "water", false);
  simulation.setStorageAcceptance(simulation.headquarters.uid, "logs", false);
  const pending = new Set(
    simulation
      .frames()
      .filter((a) => a.delivery)
      .map((a) => a.uid)
  );
  expect(pending.size).toBeGreaterThan(0);
  expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  advance(300);
  expect(simulation.frames().filter((a) => pending.has(a.uid) && a.delivery)).toEqual([]);
  expect(loadedAt.size).toBe(0);
  expect(maximumAge).toBeLessThan(240);
  expect(completed.size).toBeGreaterThan(5);
  expect(maximumStep).toBeLessThanOrEqual(0.071);
  const remainingLogs =
    simulation.buildings().reduce((sum, b) => sum + (b.output.logs ?? 0), 0) +
    simulation.frames().filter((a) => a.ware === "logs").length;
  const felled = [...world.props.types].filter((type) => type === PROP_REMOVED).length;
  expect((simulation.headquarters.inventory.logs ?? 0) + remainingLogs).toBe(100 + felled);
  expect(
    simulation.snapshot().settlersInside +
      simulation.frames().filter((a) => a.phase !== "retired").length
  ).toBe(100 + simulation.settlerBirths());
}, 30000);
