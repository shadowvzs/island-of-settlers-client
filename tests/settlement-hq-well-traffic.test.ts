import { expect, it } from "vitest";

import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

it("keeps six rapidly planned wells delivering through the shared HQ without losing settlers, tools or teleporting", () => {
  const size = 64,
    world = {
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
        count: 0,
        types: new Uint8Array(),
        x: new Float32Array(),
        z: new Float32Array(),
        scale: new Float32Array()
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
    initialStock: { planks: 300, stone: 300, logs: 100, hammer: 8 }
  });
  // Owner 2026-11-03 widened the reserved road strip to 1.3 + 2×0.5 verge: the centre well
  // needs one more tile of clearance from the HQ so the shared exit road still fits.
  const wells = [
    [18, 26],
    [25, 27],
    [32, 26],
    [18, 32],
    [25, 32],
    [32, 32]
  ].map(([x, z]) => {
    const placed = simulation.placeBuilding(35, x!, z!);
    expect(placed.ok, placed.reason).toBe(true);
    return placed.building!;
  });
  for (const well of wells)
    expect(simulation.connectRoads(simulation.headquarters.access, well.access)).toBe(true);
  const delivered: number[] = [];
  let previousWater = 0,
    maximumStep = 0;
  const advance = (seconds: number) => {
    for (let tick = 0; tick < seconds * 20; tick++) {
      const before = new Map(
        simulation
          .frames()
          .filter((a) => a.visible)
          .map((a) => [a.uid, { x: a.x, z: a.z, job: a.job }])
      );
      simulation.update(0.05);
      for (const actor of simulation.frames()) {
        const last = before.get(actor.uid);
        if (!last || !actor.visible || last.job !== actor.job) continue;
        maximumStep = Math.max(maximumStep, Math.hypot(actor.x - last.x, actor.z - last.z));
      }
    }
  };
  advance(120);
  for (let window = 0; window < 5; window++) {
    advance(120);
    const water = simulation.headquarters.inventory.water ?? 0;
    delivered.push(water);
    expect(water, `HQ deliveries every two minutes: ${JSON.stringify(delivered)}`).toBeGreaterThan(
      previousWater
    );
    previousWater = water;
    if (window === 2) expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  }
  expect(wells.every((b) => b.construction === 1)).toBe(true);
  expect(maximumStep).toBeLessThanOrEqual(0.071);
  expect(
    simulation.snapshot().settlersInside +
      simulation.frames().filter((a) => a.phase !== "retired").length
  ).toBe(100 + simulation.settlerBirths());
  expect(simulation.headquarters.inventory.hammer).toBe(8);
  expect(
    simulation.frames().filter((a) => a.job === "Builder" && a.phase !== "retired")
  ).toHaveLength(0);
}, 30000);
