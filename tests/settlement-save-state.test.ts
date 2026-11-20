import { expect, it } from "vitest";

import { createRoadNetwork } from "../src/shared/settlement/road-network";
import {
  SETTLEMENT_SAVE_VERSION,
  validateSettlementSave,
} from "../src/shared/settlement/settlement-save-state";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const session = () => {
  const size = 40;
  const world = {
    seed: 9,
    cellsX: size,
    cellsZ: size,
    seaLevel: -1,
    start: { x: 5.5, z: 5.5 },
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
  simulation = createSettlementSimulation({ world, roads, canWorkerEnterPlot: () => true });
  const result = simulation.placeBuilding(17, 15, 12);
  if (!result.ok || !result.building) throw new Error(result.reason);
  result.building.construction = 1;
  result.building.required = {};
  result.building.output.logs = 2;
  expect(roads.addRoad(simulation.headquarters.access, result.building.access)).toBe(true);
  return { simulation, roads, building: result.building, world };
};

it("distinguishes invalid, older and newer settlement save versions", () => {
  const { simulation, world } = session();
  const saved = simulation.saveState();
  const options = { world } as Parameters<typeof validateSettlementSave>[1]["options"];
  expect(validateSettlementSave({ ...saved, version: 4 }, { options })).toBeNull();
  expect(validateSettlementSave({ ...saved, version: SETTLEMENT_SAVE_VERSION + 1 }, { options }))
    .toBe("Settlement save was created by a newer version");
  expect(validateSettlementSave({ ...saved, version: 3 }, { options }))
    .toBe("Unsupported settlement save version");
  expect(validateSettlementSave({ ...saved, version: 2 }, { options }))
    .toBe("Unsupported settlement save version");
  expect(validateSettlementSave({ ...saved, version: 1 }, { options }))
    .toBe("Unsupported settlement save version");
  expect(validateSettlementSave({ ...saved, version: 0 }, { options }))
    .toBe("Unsupported settlement save version");
  expect(validateSettlementSave({ ...saved, version: "1" }, { options }))
    .toBe("Invalid settlement save version");
  expect(validateSettlementSave({ ...saved, format: "other" }, { options }))
    .toBe("Unsupported settlement save format");
});

it("round trips real in-flight cargo, stock, population, exact worker phases and upgraded roads", () => {
  const { building, roads, simulation } = session();
  for (
    let tick = 0;
    tick < 4000 &&
    !simulation.frames().some((actor) => actor.job === "Carrier" && actor.ware === "logs");
    tick++
  )
    simulation.update(0.05);
  expect(
    simulation.frames().some((actor) => actor.job === "Carrier" && actor.ware === "logs")
  ).toBe(true);
  const segment = roads.segments()[0]!;
  expect(roads.upgradeRoad(segment.start, segment.end, () => true)).toBe(true);
  simulation.setStorageAcceptance(0, "fish", false);
  const saved = simulation.saveState(),
    headquarters = simulation.headquarters;
  // Shared-storage policy is per island now; a legacy per-door fish override must not survive capture.
  expect(saved.buildings[0]!.accepts.fish).toBeUndefined();
  for (let tick = 0; tick < 300; tick++) simulation.update(0.05);
  building.output.logs = 99;
  expect(simulation.loadState(JSON.parse(JSON.stringify(saved)))).toEqual({ ok: true });
  expect(simulation.headquarters).toBe(headquarters);
  expect(simulation.saveState()).toEqual(saved);
  const before = simulation.headquarters.inventory.logs ?? 0;
  for (
    let tick = 0;
    tick < 4000 && (simulation.headquarters.inventory.logs ?? 0) === before;
    tick++
  )
    simulation.update(0.05);
  expect(simulation.headquarters.inventory.logs).toBe(before + 1);
  expect(
    simulation.buildings().find((entry) => entry.uid === building.uid)!.output.logs
  ).toBeLessThanOrEqual(1);
});

it("rejects a movement plan whose corridor reservation revision differs", () => {
  const { simulation } = session();
  for (let tick = 0; tick < 4000 &&
    !simulation.snapshot().actors.some((actor) => actor.job === "Carrier"); tick++)
    simulation.update(0.05);
  const saved = simulation.saveState();
  const actor = saved.actors.find(entry => entry.job === "Carrier");
  expect(actor, "the fixture has a carrier").toBeDefined();
  actor!.workerMovementPlan = {
    expectedArriveTick: 20, lastSafePoint: { x: actor!.x, z: actor!.z }, pathLength: 1,
    phase: actor!.phase, revision: "current-revision", startedTick: 0, status: "moving",
    target: { x: actor!.x + 1, z: actor!.z }, ware: actor!.ware ?? null, wareUnits: 1
  };
  saved.corridorReservations = [[actor!.uid, actor!.workerMovementPlan.phase,
    "stale-revision", 100, ["0,0"]]];
  expect(simulation.loadState(structuredClone(saved))).toEqual({
    ok: false, reason: "Movement plan and corridor reservation revision differ"
  });
});

it("rejects corrupt stock, world identity and road data atomically", () => {
  const { simulation } = session();
  const original = simulation.saveState();
  for (const change of [
    (save: typeof original) => {
      save.buildings[0]!.inventory.logs = -1;
    },
    (save: typeof original) => {
      save.carrierDetours = [{ actor: -1, cursor: 0, pathIndex: 0, phase: "pickup", remaining: 0 }];
    },
    (save: typeof original) => {
      save.world.seed++;
    },
    (save: typeof original) => {
      save.roads[0]!.end.x += 0.13;
    },
    (save: typeof original) => {
      save.naval.active = [[0, null as never]];
    }
  ]) {
    const corrupt = JSON.parse(JSON.stringify(original));
    change(corrupt);
    expect(simulation.loadState(corrupt).ok).toBe(false);
    expect(simulation.saveState()).toEqual(original);
  }
});

it("preserves demolition return cargo and retirees without recreating the removed building", () => {
  const { building, simulation } = session();
  for (let tick = 0; tick < 300; tick++) simulation.update(0.05);
  expect(simulation.demolishBuilding(building.uid).ok).toBe(true);
  const saved = simulation.saveState();
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  expect(simulation.saveState()).toEqual(saved);
  expect(simulation.buildings().some((entry) => entry.uid === building.uid)).toBe(false);
});

it("refuses a dangling stock-court owner before touching live stock, actors or routes", () => {
  const { simulation } = session();
  for (let tick = 0; tick < 40; tick++) simulation.update(.05);
  const saved = simulation.saveState(), malformed = structuredClone(saved);
  malformed.stockTraffic = { clock: 1, owners: [{ building: 0, actor: 999999 }], actors: [] };
  expect(simulation.loadState(malformed)).toEqual({ ok: false, reason: "Invalid stock-court traffic receipts" });
  expect(simulation.saveState()).toEqual(saved);
});

it("refuses a forged storage-door lease before changing the current queue or inventory", () => {
  const { simulation } = session();
  for (let tick = 0; tick < 40; tick++) simulation.update(.05);
  const saved = simulation.saveState(), malformed = structuredClone(saved);
  malformed.storageTraffic = { clock: 0, parkingBudget: 4, arrivalSerial: 0, watchOrder: [],
    owners: [{ building: 0, actor: 999999, identityCurrent: true }], actors: [], departures: [] };
  expect(simulation.loadState(malformed)).toEqual({ ok: false, reason: "Invalid storage-door traffic receipts" });
  expect(simulation.saveState()).toEqual(saved);
});

it("rejects aliases for absent people without changing the current snapshot", () => {
  const { simulation } = session(), saved = simulation.saveState(), malformed = structuredClone(saved);
  malformed.navigationRevisions = { build: 0, roads: 0,
    aliases: [{ actor: 999999, saved: "0/0/0", actual: "0/0/0" }] };
  expect(simulation.loadState(malformed)).toEqual({ ok: false, reason: "Invalid navigation revision aliases" });
  expect(simulation.saveState()).toEqual(saved);
});

it("persists settler demand and output-dispatch rotation and rejects malformed values", () => {
  const { simulation } = session();
  const saved = structuredClone(simulation.saveState());
  saved.settlerDemand = [saved.buildings[0]!.uid];
  saved.landDispatchCursor = 3;
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  const restored = simulation.saveState();
  expect(restored.settlerDemand).toEqual([saved.buildings[0]!.uid]);
  expect(restored.landDispatchCursor).toBe(3);
  for (const [field, value] of [["settlerDemand", [999999]], ["landDispatchCursor", -1]] as const) {
    const malformed = structuredClone(restored);
    (malformed as unknown as Record<string, unknown>)[field] = value;
    expect(simulation.loadState(malformed).ok).toBe(false);
    expect(simulation.saveState()).toEqual(restored);
  }
});

it("preserves navigation retry age and returned cargo receipts, validating new optional fields atomically", () => {
  const { simulation } = session();
  for (let tick = 0; tick < 40; tick++) simulation.update(.05);
  const actor = simulation.frames().find(unit => unit.path.length)!;
  const destination = actor.path.at(-1)!;
  actor.navigationRecovery = { task: `${actor.phase}/${destination.x}/${destination.z}`,
    elapsed: 5.5, attempts: 1, revision: "0/0/0", blocked: false, notified: false };
  actor.navigationReturnCargo = true;
  const saved = simulation.saveState();
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  expect(simulation.frames().find(unit => unit.uid === actor.uid)!.navigationRecovery!.elapsed).toBe(5.5);
  expect(simulation.frames().find(unit => unit.uid === actor.uid)!.navigationReturnCargo).toBe(true);
  const malformed = structuredClone(saved);
  malformed.actors.find(unit => unit.uid === actor.uid)!.navigationRecovery!.attempts = 99;
  expect(simulation.loadState(malformed).ok).toBe(false);
  expect(simulation.saveState()).toEqual(saved);
  for (const sampler of [
    { remaining: -1, sampled: .1, outcome: "moving", pathMatchesCurrent: true },
    { remaining: 1, sampled: .5, outcome: "moving", pathMatchesCurrent: true },
    { remaining: 1, sampled: .1, outcome: "unknown", pathMatchesCurrent: true },
    { remaining: 1, sampled: .1, outcome: "moving", pathMatchesCurrent: 1 }
  ]) {
    const corrupt = structuredClone(saved);
    Object.assign(corrupt.actors.find(unit => unit.uid === actor.uid)!.navigationRecovery!, { sampler });
    expect(simulation.loadState(corrupt)).toEqual({ ok: false, reason: "Invalid navigation progress sampler" });
    expect(simulation.saveState()).toEqual(saved);
  }
  for (const unit of saved.actors) { delete unit.navigationRecovery; delete unit.navigationReturnCargo; }
  expect(simulation.loadState(saved)).toEqual({ ok: true });
});

it("persists a walker's traffic queue kind and rejects unknown kinds", () => {
  const { simulation } = session();
  for (let tick = 0; tick < 40; tick++) simulation.update(.05);
  const actor = simulation.frames().find(unit => unit.visible && unit.path.length)!;
  actor.queueTarget = { x: actor.x + .3, z: actor.z };
  actor.queueKind = "proactive";
  const saved = simulation.saveState();
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  expect(simulation.frames().find(unit => unit.uid === actor.uid)!.queueKind).toBe("proactive");
  const malformed = structuredClone(saved);
  (malformed.actors.find(unit => unit.uid === actor.uid) as { queueKind?: string }).queueKind = "shove";
  expect(simulation.loadState(malformed).ok).toBe(false);
  for (const unit of saved.actors) delete unit.queueKind;
  expect(simulation.loadState(saved)).toEqual({ ok: true });
});

it("preserves storage FIFO ages across reloads and rejects invalid serials atomically", () => {
  const { simulation } = session();
  for (let tick = 0; tick < 40; tick++) simulation.update(.05);
  const actor = simulation.frames().find(unit => unit.visible && unit.path.length)!;
  actor.storageArrivalBuilding = simulation.headquarters.uid;
  actor.storageArrivalOrder = 123;
  const saved = structuredClone(simulation.saveState());
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  const restored = simulation.frames().find(unit => unit.uid === actor.uid)!;
  expect(restored.storageArrivalOrder).toBe(123);
  expect(restored.storageArrivalBuilding).toBe(simulation.headquarters.uid);
  for (const invalid of [-1, 0, .5, Infinity]) {
    const malformed = structuredClone(saved);
    malformed.actors.find(unit => unit.uid === actor.uid)!.storageArrivalOrder = invalid;
    expect(simulation.loadState(malformed).ok).toBe(false);
    expect(simulation.saveState()).toEqual(saved);
  }
  for (const unit of saved.actors) { delete unit.storageArrivalBuilding; delete unit.storageArrivalOrder; }
  expect(simulation.loadState(saved)).toEqual({ ok: true });
});

