import { expect, it } from "vitest";

import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

it("returns an idle storage worker's tool and turns the person back into an idle settler", () => {
  const size = 64;
  const world = {
    seed: 6, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 8, z: 8 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    mineZones: [], mineZone: new Uint16Array(size ** 2), oreAmount: new Uint8Array(size ** 2),
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array() }
  } as unknown as WorldData;
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 10,
    initialStock: { saw: 1, hammer: 2 } });
  const saved = simulation.saveState();
  saved.settlers = 0;
  for (const building of saved.buildings) delete building.idleSettlers;
  saved.actors = [{
    uid: 0, ...simulation.headquarters.doorThreshold, y: simulation.headquarters.y, yaw: 0,
    visible: false, job: "Carpenter", action: "idle", ware: null, tool: "saw", phase: "inside",
    home: simulation.headquarters.uid, building: simulation.headquarters.uid,
    path: [], pathIndex: 0, timer: 0, animationTime: 0
  }];
  saved.nextActor = 1;
  const saw = simulation.headquarters.inventory.saw ?? 0;
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  expect(simulation.headquarters.inventory.saw).toBe(saw + 1);
  expect(simulation.availableSettlers()).toBe(1);
  simulation.update(.05);
  expect(simulation.headquarters.inventory.saw).toBe(saw + 1);
  expect(simulation.availableSettlers()).toBe(1);
  expect(simulation.frames().some(actor => actor.tool === "saw" || actor.job === "Carpenter"))
    .toBe(false);
});

it("reclaims idle stored carriers after load and recruits builders without losing settlers or hammers", () => {
  const size = 64;
  const world = {
    seed: 5,
    cellsX: size,
    cellsZ: size,
    seaLevel: -1,
    start: { x: 8, z: 8 },
    heights: new Float32Array((size + 1) ** 2),
    blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10),
    buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    mineZones: [],
    mineZone: new Uint16Array(size ** 2),
    oreAmount: new Uint8Array(size ** 2),
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array() }
  } as unknown as WorldData;
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, {
    isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false
  });
  simulation = createSettlementSimulation({
    world,
    roads,
    initialSettlers: 100,
    initialStock: { hammer: 6, planks: 72, stone: 46, logs: 36, saw: 2 }
  });
  const plans = [simulation.placeBuilding(35, 24, 12), simulation.placeBuilding(33, 28, 20.5)];
  for (const result of plans) {
    expect(result.ok, result.reason).toBe(true);
    expect(simulation.connectRoads(simulation.headquarters.access, result.building!.access)).toBe(
      true
    );
  }
  const saved = simulation.saveState();
  saved.settlers = 0;
  for (const building of saved.buildings) {
    delete building.idleSettlers;
  }
  saved.actors = Array.from({ length: 100 }, (_, uid) => ({
    uid,
    ...simulation.headquarters.doorThreshold,
    y: simulation.headquarters.y,
    yaw: 0,
    visible: false,
    job: "Carrier",
    action: "idle",
    ware: null,
    phase: "inside",
    home: simulation.headquarters.uid,
    building: simulation.headquarters.uid,
    path: [],
    pathIndex: 0,
    timer: 0,
    animationTime: 0
  }));
  saved.nextActor = 100;
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  for (let tick = 0; tick < 20; tick++) simulation.update(0.05);
  expect(simulation.frames().filter((actor) => actor.job === "Builder")).toHaveLength(2);
  expect(simulation.headquarters.inventory.hammer).toBe(4);
  expect(simulation.availableSettlers()).toBeGreaterThan(90);
  const population = () =>
    simulation.availableSettlers() +
    simulation.frames().filter((actor) => actor.phase !== "retired").length;
  expect(population()).toBe(100);
  const incoming = plans.reduce(
    (sum, result) =>
      sum +
      Object.values(
        simulation.buildings().find((building) => building.uid === result.building!.uid)!.incoming
      ).reduce((count, value) => count + value, 0),
    0
  );
  expect(incoming).toBeGreaterThan(0);
  expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  for (let tick = 0; tick < 20; tick++) simulation.update(0.05);
  expect(population()).toBe(100);
  expect(simulation.frames().filter((actor) => actor.job === "Builder")).toHaveLength(2);
  expect(simulation.headquarters.inventory.hammer).toBe(4);
});
