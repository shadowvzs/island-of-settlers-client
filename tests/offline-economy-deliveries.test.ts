import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { stageGameSession } from "../src/app/settlement/game-session";
import { prepareOfflineEconomyDeliveries } from "../src/app/settlement/offline-economy-deliveries";
import { type OfflineEconomyJob, runOfflineEconomyEvents } from "../src/app/settlement/offline-economy-events";
import { estimateOfflineEconomyRates } from "../src/app/settlement/offline-economy-rates";
import { advanceOfflineGame } from "../src/app/settlement/offline-progress";
import { createGameSave, type GameSaveV1 } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementActor, SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { huntingWorld } from "./helpers/hunting-world";

const fixture = () => {
  const world = huntingWorld(), simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world), initialSettlers: 10 });
  const head = simulation.headquarters;
  if (!simulation.connectRoads(head.access, { x: head.access.x + 2, z: head.access.z })) throw new Error("fixture road");
  const state = simulation.saveState(), home = state.buildings[0]!;
  home.construction = 1;
  const source: SettlementBuilding = { ...structuredClone(home), uid: 10, typeId: 28, inventory: {}, output: { pig: 2 } };
  const destination: SettlementBuilding = { ...structuredClone(home), uid: 11, typeId: 8, inventory: {}, input: {}, incoming: { pig: 1 } };
  state.buildings.push(source, destination);
  const actor: SettlementActor = { uid: 80, x: home.access.x, z: home.access.z, y: 2, yaw: 0, visible: true,
    job: "Carrier", action: "walk", ware: null, phase: "pickup", building: destination.uid, home: home.uid,
    path: [{ ...source.access }], pathIndex: 0, timer: 0, animationTime: 0,
    delivery: { source: source.uid, destination: destination.uid, ware: "pig", reserved: true,
      leaseStartedTick: 0, leaseDeadlineTick: 6000 } };
  state.actors.push(actor); state.gameTick = 0;
  const save = { settlement: state, savedAt: 1000 } as GameSaveV1;
  const recipe: OfflineEconomyJob = { uid: "building:11", islandId: "home", cycleTicks: 1000,
    inputs: { pig: 1 }, inputTargets: { pig: 2 }, outputs: { meat: 1 } };
  const prepare = (seconds = 3600) => prepareOfflineEconomyDeliveries(save, "home", seconds, world, [recipe], [home.uid]);
  const run = (prepared: ReturnType<typeof prepare>, horizonTicks = 3_600_000, capacity = 100, extras: OfflineEconomyJob[] = []) =>
    runOfflineEconomyEvents({ horizonTicks,
      islands: [{ islandId: "home", stock: {}, capacities: { pig: 0, meat: capacity } }, ...prepared.islands],
      jobs: [{ ...recipe, uid: "home:building:11", endTick: horizonTicks }, ...extras, ...prepared.jobs] });
  return { world, state, save, home, source, destination, actor, recipe, prepare, run };
};

describe("offline saved cartless delivery continuation", () => {
  it("moves an existing reserved receipt to its workshop privately, then returns the same carrier home", () => {
    const f = fixture(), before = JSON.stringify(f.save), prepared = f.prepare();
    expect(prepared.jobs).toHaveLength(1);
    expect(prepared.jobs[0]!.cycleTicks).toBeGreaterThan(2000);
    expect(JSON.stringify(f.save)).toBe(before);
    const result = f.run(prepared), ledger = result.islands[0]!;
    expect(ledger.produced.meat).toBe(1);
    expect(ledger.stock.pig ?? 0).toBe(0);
    prepared.apply(result.completedCycles, ledger, result.buffers);
    expect(f.source.output.pig).toBe(1);
    expect(f.destination.incoming.pig).toBe(0);
    expect(f.destination.input).toEqual({});
    expect(ledger.received.pig).toBe(0);
    expect(f.actor).toMatchObject({ uid: 80, home: f.home.uid, building: f.destination.uid,
      x: f.home.doorThreshold.x, z: f.home.doorThreshold.z, phase: "inside", ware: null, visible: false, action: "idle" });
    expect(f.actor.delivery).toBeUndefined();
    expect(f.actor.path).toEqual([]);
    expect(f.prepare().jobs).toEqual([]);
    expect(() => prepared.apply(result.completedCycles, ledger, result.buffers)).toThrow("already applied");
  });

  it("preserves all original ownership when the full return cannot finish before the cutoff", () => {
    const f = fixture(), before = JSON.stringify(f.save), prepared = f.prepare(.001), result = f.run(prepared, 1);
    expect(result.inProgress).toEqual([]);
    prepared.apply(result.completedCycles, result.islands[0]!, result.buffers);
    expect(JSON.stringify(f.save)).toBe(before);
  });

  it("does not refund a dispatch-prepaid storage receipt that was not yet gripped", () => {
    const f = fixture();
    f.actor.delivery!.source = f.home.uid; f.actor.delivery!.reserved = false;
    f.home.inventory.pig = 5;
    const prepared = f.prepare(), result = f.run(prepared, 3_600_000, 0), ledger = result.islands[0]!;
    expect(ledger.stock.pig ?? 0).toBe(0);
    prepared.apply(result.completedCycles, ledger, result.buffers);
    expect(f.home.inventory.pig).toBe(5);
    expect(f.destination.input.pig).toBe(1);
    expect(f.actor.ware).toBeNull();
  });

  it("continues an already-gripped partial pickup animation without debiting its producer twice", () => {
    const f = fixture();
    const original = f.prepare().jobs[0]!.cycleTicks;
    f.source.output.pig = 0; f.actor.phase = "pickupTransfer"; f.actor.ware = "pig";
    f.actor.delivery!.reserved = false;
    f.actor.wareTransfer = { direction: "pickup", ware: "pig", progress: .5, target: { ...f.source.access, y: 2 } };
    const prepared = f.prepare(), result = f.run(prepared);
    expect(prepared.jobs[0]!.cycleTicks).toBeLessThan(original);
    prepared.apply(result.completedCycles, result.islands[0]!, result.buffers);
    expect(f.source.output.pig).toBe(0);
    expect(f.actor.wareTransfer).toBeUndefined();
    expect(f.actor.delivery).toBeUndefined();
  });

  it("prevents a competing recipe from stealing a promised input and saves unused input at the receiver", () => {
    const f = fixture(), prepared = f.prepare();
    const thief = { ...f.recipe, uid: "thief", outputs: { other: 1 } };
    const result = f.run(prepared, 3_600_000, 0, [thief]), ledger = result.islands[0]!;
    expect(ledger.produced).toEqual({});
    expect(ledger.stock.pig ?? 0).toBe(0);
    expect(result.buffers.find(buffer => buffer.uid === "home:building:11")?.deliveredStock).toEqual({ pig: 1 });
    prepared.apply(result.completedCycles, ledger, result.buffers);
    expect(f.destination.input.pig).toBe(1);
    expect(f.destination.incoming.pig).toBe(0);
  });

  it("clears only a completed carrier's leases and preserves another receipt's reserved source and incoming slot", () => {
    const f = fixture();
    const other = structuredClone(f.actor); other.uid = 81; other.path = [{ x: f.source.access.x + 100, z: f.source.access.z }];
    f.state.actors.push(other); f.destination.incoming.pig = 2;
    f.actor.workerMovementPlan = { phase: "pickup", pathLength: 1, revision: "r", startedTick: 0, expectedArriveTick: 20,
      lastSafePoint: { ...f.actor }, target: { ...f.source.access }, status: "planned", ware: null,
      manifest: { source: 10, destination: 11, ware: "pig", units: 1 }, claims: { source: false, destination: true } };
    f.actor.workerHandlingPlan = { phase: "pickup", direction: "pickup", ware: "pig", status: "active", startedTick: 0, expectedEndTick: 20 };
    f.actor.storageArrivalBuilding = 0; f.actor.storageArrivalOrder = 1;
    f.state.corridorReservations = [[80, "pickup", "r", 600, ["0,0"]], [81, "pickup", "r", 600, ["1,1"]]];
    const prepared = f.prepare(), cutoff = prepared.jobs[0]!.cycleTicks + 1000, result = f.run(prepared, cutoff);
    prepared.apply(result.completedCycles, result.islands[0]!, result.buffers);
    expect(f.source.output.pig).toBe(1);
    expect(f.destination.incoming.pig).toBe(1);
    expect(other.delivery).toBeDefined();
    expect(f.actor.workerMovementPlan).toBeUndefined();
    expect(f.actor.workerHandlingPlan).toBeUndefined();
    expect(f.actor.storageArrivalBuilding).toBeUndefined();
    expect(f.state.corridorReservations.map(([uid]) => uid)).toEqual([81]);
  });

  it("retains expired, unowned and unsupported delivery receipts", () => {
    const f = fixture();
    f.actor.delivery!.leaseDeadlineTick = 0;
    expect(f.prepare().jobs).toEqual([]);
    f.actor.delivery!.leaseDeadlineTick = 6000; f.destination.incoming.pig = 0;
    expect(f.prepare().jobs).toEqual([]);
    f.destination.incoming.pig = 1; f.actor.delivery!.sourceInput = true;
    expect(f.prepare().jobs).toEqual([]);
  });

  it("validates completion, private buffer balances, source and credits before changing any receipt", () => {
    const f = fixture(), prepared = f.prepare(), result = f.run(prepared, 3_600_000, 0), ledger = result.islands[0]!;
    const before = JSON.stringify(f.save), uid = prepared.jobs[0]!.uid;
    expect(() => prepared.apply({ [uid]: 2 }, ledger, result.buffers)).toThrow("more than once");
    ledger.received.pig = 0;
    expect(() => prepared.apply(result.completedCycles, ledger, result.buffers)).toThrow("missing private destination credit");
    ledger.received.pig = 1;
    const buffer = result.buffers.find(buffer => buffer.uid === "home:building:11")!;
    buffer.deliveredStock!.pig = 2;
    expect(() => prepared.apply(result.completedCycles, ledger, result.buffers)).toThrow("private buffer balance");
    expect(JSON.stringify(f.save)).toBe(before);
    buffer.deliveredStock!.pig = 1;
    prepared.apply(result.completedCycles, ledger, result.buffers);
    expect(f.destination.input.pig).toBe(1);
  });

  it("resumes the developed save's two reserved pig receipts without cargo duplication", async () => {
    const source = JSON.parse(await readFile(new URL("../public/demo/continued-0.json", import.meta.url), "utf8")) as GameSaveV1;
    source.archipelago = undefined;
    const save = await advanceOfflineGame(source, source.savedAt + 120_000, () => {}, { exact: true, eventCore: false });
    const loaded = await stageGameSession(save), world = loaded.map.world;
    const rates = estimateOfflineEconomyRates(save, world);
    const recipes = rates.jobs.filter(job => Object.hasOwn(job.inputs, "pig"));
    const prepared = prepareOfflineEconomyDeliveries(save, "home", 3600, world, recipes, rates.storageUids);
    expect(prepared.jobs.filter(job => job.destinationBufferUid)).toHaveLength(2);
    const result = runOfflineEconomyEvents({ horizonTicks: 3_600_000,
      islands: [{ islandId: "home", stock: {}, capacities: { pig: 0, meat: 100 } }, ...prepared.islands],
      jobs: [...recipes.map(job => ({ ...job, uid: `home:${job.uid}`, endTick: 3_600_000 })), ...prepared.jobs] });
    const ledger = result.islands[0]!;
    // One reserved pig goes to the butcher (meat) and one to the skinner (hides).
    expect(ledger.produced.meat).toBe(1);
    expect(ledger.produced.hides).toBe(1);
    prepared.apply(result.completedCycles, ledger, result.buffers);
    const pool = save.settlement.storagePools.pools.find(entry =>
      entry.id === save.settlement.buildings[0]!.storagePoolId)!;
    for (const [ware, units] of Object.entries(ledger.stock)) if (units)
      pool.available[ware] = (pool.available[ware] ?? 0) + units;
    const encoded = await createGameSave(world, save.settlement, { ...loaded.map.meta,
      animals: loaded.map.animals, terrain: loaded.map.terrain, savedAt: save.savedAt + 3_600_000 }, save.runtime);
    expect(encoded.settlement.stockTraffic?.actors.filter(receipt =>
      encoded.settlement.actors.find(actor => actor.uid === receipt.actor)?.phase !== receipt.phase) ?? []).toEqual([]);
    await expect(stageGameSession(encoded)).resolves.toBeDefined();
    expect(prepareOfflineEconomyDeliveries(encoded, "home", 3600, world, recipes, rates.storageUids).jobs).toEqual([]);
  }, 20_000);
});
