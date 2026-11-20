import { describe, expect, it } from "vitest";

import { prepareOfflineEconomyDeliveries } from "../src/app/settlement/offline-economy-deliveries";
import { type OfflineEconomyJob, runOfflineEconomyEvents } from "../src/app/settlement/offline-economy-events";
import { prepareOfflineEconomyLogistics } from "../src/app/settlement/offline-economy-logistics";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { Goods, SettlementActor, SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { huntingWorld } from "./helpers/hunting-world";

const fixture = () => {
  const world = huntingWorld(), simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world), initialSettlers: 10 });
  const hq = simulation.headquarters;
  if (!simulation.connectRoads(hq.access, { x: hq.access.x + 20, z: hq.access.z })) throw new Error("fixture road");
  const state = simulation.saveState(), home = state.buildings[0]!; home.construction = 1;
  const building = (uid: number, typeId: number, offset: number): SettlementBuilding => {
    const value = structuredClone(home);
    Object.assign(value, { uid, typeId, x: home.x + offset, input: {}, output: {}, inventory: {}, incoming: {},
      access: { x: home.access.x + offset, z: home.access.z },
      workerApproach: { x: home.workerApproach.x + offset, z: home.workerApproach.z },
      doorThreshold: { x: home.doorThreshold.x + offset, z: home.doorThreshold.z } });
    state.buildings.push(value); return value;
  };
  const producer = building(10, 9, 8), consumer = building(11, 12, 16);
  producer.output.bread = 1;
  const make = (uid: number, inputs: Goods, outputs: Goods): OfflineEconomyJob => ({ uid: `building:${uid}`, islandId: "home",
    cycleTicks: 1000, inputs, outputs, inputTargets: Object.fromEntries(Object.keys(inputs).map(ware => [ware, 2])) });
  const sourceJob = make(10, {}, { bread: 1 }), consumerJob = make(11, { bread: 1 }, { ironOre: 1 });
  const definitions = [sourceJob, consumerJob], save = { settlement: state, savedAt: 1000 } as GameSaveV1;
  const prepare = (seconds = 600, selected = definitions) => prepareOfflineEconomyLogistics(save, "home", seconds, world, selected, [home.uid]);
  const run = (prepared: ReturnType<typeof prepare>, horizonTicks = 600_000, stock: Goods = {}, capacities: Goods = { bread: 0, ironOre: 100 }) =>
    runOfflineEconomyEvents({ horizonTicks,
      islands: [{ islandId: "home", stock, capacities, workCapacity: 100 }, ...prepared.islands],
      jobs: [...definitions.map(job => ({ ...job, uid: `home:${job.uid}`, endTick: horizonTicks })), ...prepared.jobs] });
  return { world, state, home, producer, consumer, definitions, sourceJob, consumerJob, save, prepare, run, make };
};

describe("offline producer-owned logistics metadata", () => {
  it("reopens a yard full of saved export promises only when those original receipts complete", () => {
    const f = fixture(); f.producer.output.bread = 6; f.home.incoming.bread = 6;
    f.consumerJob.outputSequence = [];
    for (let index = 0; index < 6; index++) f.state.actors.push({
      uid: 80 + index, job: "Carrier", home: f.home.uid, building: f.home.uid,
      x: f.producer.access.x, y: 0, z: f.producer.access.z, ware: null, phase: "pickup",
      path: [], pathIndex: 0, delivery: { source: f.producer.uid, destination: f.home.uid,
        ware: "bread", reserved: true }
    } as unknown as SettlementActor);
    const logistics = f.prepare();
    expect(logistics.islands[0]!.totalCapacity).toBe(0);
    const deliveries = prepareOfflineEconomyDeliveries(f.save, "home", 600, f.world,
      f.definitions, [f.home.uid], logistics.outputAccounts);
    expect(deliveries.jobs).toHaveLength(6);
    const result = runOfflineEconomyEvents({ horizonTicks: 600_000,
      islands: [{ islandId: "home", stock: {}, workCapacity: 100 },
        ...logistics.islands, ...deliveries.islands],
      jobs: [...f.definitions.map(job => ({ ...job, uid: `home:${job.uid}`, endTick: 600_000 })),
        ...logistics.jobs, ...deliveries.jobs] });
    expect(result.islands[0]!.produced.bread).toBeGreaterThan(6);
    expect(result.islands.find(island => island.islandId === f.sourceJob.outputAccountId)!.totalCapacity).toBe(6);
    logistics.apply(result);
    deliveries.apply(result.completedCycles, result.islands[0]!, result.buffers);
    expect(f.home.incoming.bread).toBe(0);
    expect(f.state.actors.every(actor => !actor.delivery)).toBe(true);
    expect((result.islands[0]!.stock.bread ?? 0) + (f.producer.output.bread ?? 0))
      .toBe(6 + result.islands[0]!.produced.bread!);
    expect(prepareOfflineEconomyDeliveries(f.save, "home", 600, f.world,
      f.definitions, [f.home.uid]).jobs).toEqual([]);
  });
  it("plans without changing physical ownership and orders real suppliers by native source-route cost", () => {
    const f = fixture(), before = JSON.stringify(f.save), prepared = f.prepare();
    expect(JSON.stringify(f.save)).toBe(before);
    expect(prepared.coveredOutputUids).toEqual([10, 11]);
    expect(f.sourceJob.outputAccountId).toBeDefined();
    expect(f.consumerJob.inputSuppliers!.bread!.map(source => source.accountId)).toEqual([f.sourceJob.outputAccountId, "home"]);
    expect(f.consumerJob.inputSuppliers!.bread![0]!.deliveryTicks).toBeGreaterThan(1000);
    expect(f.consumerJob.inputSuppliers!.bread![0]!.workTicks).toBeGreaterThan(f.consumerJob.inputSuppliers!.bread![0]!.deliveryTicks);
    expect(prepared.islands[0]).toMatchObject({ ownerIslandId: "home", stock: { bread: 1 }, totalCapacity: 6 });
    expect(prepared.jobs.every(job => job.workOwnerIslandId === "home" && job.endTick === 600_000)).toBe(true);
  });

  it("delivers a finite producer unit privately without claiming that it reached a warehouse first", () => {
    const f = fixture(); f.sourceJob.outputSequence = []; f.consumerJob.outputSequence = [{ ironOre: 1 }];
    const prepared = f.prepare(), result = f.run(prepared), owner = result.islands[0]!;
    expect(owner.produced.ironOre).toBe(1);
    expect(owner.produced.bread ?? 0).toBe(0);
    expect(owner.stock.bread ?? 0).toBe(0);
    prepared.apply(result);
    expect(f.producer.output.bread ?? 0).toBe(0);
    expect(f.consumer.input.bread ?? 0).toBe(0);
    expect(() => prepared.apply(result)).toThrow("already applied");
  });

  it("preserves reserved carrier/cart units and a paid worker's output slot outside the account", () => {
    const f = fixture(); f.producer.output.bread = 3;
    f.state.actors.push({ uid: 80, delivery: { source: 10, destination: 11, ware: "bread", reserved: true } } as SettlementActor);
    f.state.actors.push({ uid: 81, handcart: { trip: { source: 10, ware: "bread", planned: 3, loaded: 1, prepaid: 1 } } } as SettlementActor);
    f.producer.worker = 82;
    f.state.actors.push({ uid: 82, ware: "bread", phase: "outputWalk" } as SettlementActor);
    f.sourceJob.outputSequence = []; f.consumerJob.outputSequence = [];
    const prepared = f.prepare(.001);
    expect(prepared.islands[0]).toMatchObject({ stock: { bread: 1 }, totalCapacity: 3 });
    const beforeActors = JSON.stringify(f.state.actors), result = f.run(prepared, 1);
    prepared.apply(result);
    expect(f.producer.output.bread).toBe(3);
    expect(JSON.stringify(f.state.actors)).toBe(beforeActors);
  });

  it("uses one shared six-unit yard across mixed tool outputs", () => {
    const f = fixture(); f.producer.typeId = 13; f.producer.output = { axe: 4, saw: 1 };
    f.sourceJob.outputs = { axe: 0, saw: 0 };
    f.sourceJob.outputSequence = [{ axe: 1 }, { saw: 1 }, { axe: 1 }];
    f.consumerJob.outputSequence = [];
    const prepared = f.prepare(), result = f.run(prepared, 600_000, {}, { axe: 0, saw: 0, ironOre: 0 });
    const account = result.islands.find(island => island.islandId === f.sourceJob.outputAccountId)!;
    expect(Object.values(account.stock).reduce((sum, units) => sum + units, 0)).toBe(6);
    expect(result.islands[0]!.produced).toEqual({ axe: 1 });
    prepared.apply(result);
    expect(f.producer.output).toEqual({ axe: 5, saw: 1 });
  });

  it("keeps plain woodcutters behind their warehouse export boundary", () => {
    const f = fixture(); f.producer.typeId = 17; f.producer.output = { logs: 1 };
    f.sourceJob.outputs = { logs: 1 }; f.consumerJob.inputs = { logs: 1 }; f.consumerJob.inputTargets = { logs: 2 };
    const prepared = f.prepare();
    expect(f.consumerJob.inputSuppliers!.logs!.map(source => source.accountId)).toEqual(["home"]);
    expect(prepared.jobs.some(job => job.islandId === f.sourceJob.outputAccountId && job.outputs.logs === 1)).toBe(true);
  });

  it("retains grouped output phases and physical boat handling without inventing extra yard capacity", () => {
    const f = fixture(); f.producer.typeId = 27; f.sourceJob.outputs = { coal: 6 };
    f.consumer.typeId = 36; f.consumerJob.inputs = { planks: 1 }; f.consumerJob.inputTargets = { planks: 2 };
    f.consumerJob.outputs = { boat: 1 };
    const prepared = f.prepare();
    expect(prepared.coveredOutputUids).toEqual([]);
    expect(f.sourceJob.outputAccountId).toBeUndefined();
    expect(f.sourceJob.inputSuppliers).toBeUndefined();
    expect(f.consumerJob.outputAccountId).toBeUndefined();
    expect(f.consumerJob.inputSuppliers!.planks![0]!.accountId).toBe("home");
  });

  it("persists unused direct input at its workshop while respecting zero warehouse capacity", () => {
    const f = fixture(); f.sourceJob.outputSequence = [];
    // A genuinely full physical yard blocks production while the promised input still arrives.
    f.consumer.output.ironOre = 6;
    const prepared = f.prepare();
    const blocked = f.run(prepared, 600_000, {}, { bread: 0, ironOre: 0 });
    expect(blocked.islands[0]!.stock.bread ?? 0).toBe(0);
    expect(blocked.buffers.find(buffer => buffer.uid === "home:building:11")?.directStock).toEqual({ bread: 1 });
    prepared.apply(blocked);
    expect(f.consumer.input.bread).toBe(1);
    expect(f.producer.output.bread ?? 0).toBe(0);
    expect(blocked.islands[0]!.produced.ironOre ?? 0).toBe(0);
  });

  it("exports finite owned output once and removes internal export receipts", () => {
    const f = fixture(); f.producer.output.bread = 3; f.sourceJob.outputSequence = []; f.consumerJob.outputSequence = [];
    const prepared = f.prepare(), exportJob = prepared.jobs.find(job => job.inputs.bread)!;
    const horizon = exportJob.cycleTicks, result = f.run(prepared, horizon, {}, { bread: 100, ironOre: 100 });
    expect(result.islands[0]!.stock.bread).toBe(3);
    expect(result.islands[0]!.received.bread).toBe(3);
    prepared.apply(result);
    expect(result.islands[0]!.received.bread).toBe(0);
    expect(f.producer.output.bread).toBe(0);
  });

  it("uses saved crew homes rather than an empty closer depot, with parallel exports sharing work", () => {
    const f = fixture(); f.home.idleSettlers = 0;
    const empty = structuredClone(f.home); empty.uid = 19; empty.idleSettlers = 0;
    empty.access = { ...f.producer.access }; f.state.buildings.push(empty);
    f.state.actors.push({ uid: 80, job: "Carrier", phase: "deliver", home: f.home.uid } as SettlementActor);
    f.state.actors.push({ uid: 81, job: "Carrier", phase: "home", home: f.home.uid } as SettlementActor);
    const prepared = prepareOfflineEconomyLogistics(f.save, "home", 600, f.world, f.definitions, [f.home.uid, 19]);
    const direct = f.consumerJob.inputSuppliers!.bread!.find(supplier => supplier.accountId === f.sourceJob.outputAccountId)!;
    expect(direct.deliveryTicks).toBeGreaterThan(20_000);
    const exports = prepared.jobs.filter(job => job.inputs.bread === 1);
    expect(exports).toHaveLength(2);
    expect(exports.every(job => job.workOwnerIslandId === "home")).toBe(true);
    expect(exports.every(job => job.cycleTicks === job.workTicks && job.workOverlapsCycle)).toBe(true);
  });

  it("validates every yard balance and original ownership before mutating physical outputs", () => {
    const f = fixture(); f.sourceJob.outputSequence = []; f.consumerJob.outputSequence = [];
    const prepared = f.prepare(.001), result = f.run(prepared, 1), before = JSON.stringify(f.save);
    const account = result.islands.find(island => island.islandId === f.sourceJob.outputAccountId)!;
    account.stock.bread = 2;
    expect(() => prepared.apply(result)).toThrow("producer balance");
    expect(JSON.stringify(f.save)).toBe(before);
    account.stock.bread = 1; f.producer.output.bread = 0;
    expect(() => prepared.apply(result)).toThrow("ownership changed");
  });
});
