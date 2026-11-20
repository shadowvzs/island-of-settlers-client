import { describe, expect, it } from "vitest";

import { runOfflineEconomyEvents } from "../src/app/settlement/offline-economy-events";
import { prepareOfflineEconomyOutputs } from "../src/app/settlement/offline-economy-outputs";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";
import { huntingWorld } from "./helpers/hunting-world";

const fixture = () => {
  const world = huntingWorld(), simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world), initialSettlers: 10 });
  const head = simulation.headquarters;
  if (!simulation.connectRoads(head.access, { x: head.access.x + 2, z: head.access.z })) throw new Error("fixture road");
  const state = simulation.saveState(), home = state.buildings[0]!;
  const producer = structuredClone(home);
  Object.assign(producer, { uid: 10, typeId: 33, x: home.x + 8, output: { planks: 4 }, inventory: {} });
  state.buildings.push(producer);
  state.settlers = 10;
  home.construction = 1;
  producer.construction = 1;
  const save = { settlement: state, savedAt: 1000 } as GameSaveV1;
  const prepare = (seconds = 3600, storageUids = [home.uid]) =>
    prepareOfflineEconomyOutputs(save, "home", seconds, world, storageUids);
  const run = (prepared: ReturnType<typeof prepare>, horizonTicks = 3_600_000, capacity = 100) =>
    runOfflineEconomyEvents({ horizonTicks, islands: [{ islandId: "home", stock: {}, capacities: { planks: capacity } },
      ...prepared.islands], jobs: prepared.jobs });
  return { save, state, home, producer, prepare, run };
};

describe("offline freely owned completed output collection", () => {
  it("plans without mutation and holds already-produced goods until a full courier trip completes", () => {
    const f = fixture(), before = JSON.stringify(f.save), prepared = f.prepare(), job = prepared.jobs[0]!;
    expect(job.cycleTicks).toBeGreaterThan(8000);
    const pending = f.run(prepared, job.cycleTicks - 1);
    expect(pending.islands[0]!.stock).toEqual({});
    expect(pending.islands[0]!.produced).toEqual({});
    expect(JSON.stringify(f.save)).toBe(before);
    prepared.apply(pending.completedCycles, pending.islands[0]!);
    expect(f.producer.output).toEqual({ planks: 4 });
  });

  it("moves output once, removes internal receipts and leaves actors untouched", () => {
    const f = fixture(), actors = JSON.stringify(f.state.actors), prepared = f.prepare(), result = f.run(prepared);
    expect(result.islands[0]!.stock).toEqual({ planks: 4 });
    expect(result.islands[0]!.produced).toEqual({});
    prepared.apply(result.completedCycles, result.islands[0]!);
    expect(f.producer.output).toEqual({ planks: 0 });
    expect(result.islands[0]!.received).toEqual({ planks: 0 });
    expect(JSON.stringify(f.state.actors)).toBe(actors);
    expect(f.prepare().jobs).toEqual([]);
    expect(() => prepared.apply(result.completedCycles, result.islands[0]!)).toThrow("already applied");
  });

  it("preserves individual and cart reservations while collecting only free output", () => {
    const f = fixture();
    f.state.actors.push({ uid: 80, delivery: { source: 10, destination: 0, ware: "planks", reserved: true } } as SettlementActor);
    f.state.actors.push({ uid: 81, handcart: { trip: { source: 10, ware: "planks", planned: 3, loaded: 1, prepaid: 1 } } } as SettlementActor);
    f.state.actors.push({ uid: 82, delivery: { source: 10, ware: "planks", reserved: true, sourceInput: true } } as SettlementActor);
    const prepared = f.prepare(), result = f.run(prepared);
    expect(prepared.jobs[0]!.inputs).toEqual({ planks: 2 });
    prepared.apply(result.completedCycles, result.islands[0]!);
    expect(f.producer.output.planks).toBe(2);
    expect(f.state.actors.at(-2)!.handcart!.trip!.planned).toBe(3);
  });

  it("defers malformed negative holds and overclaimed output", () => {
    const f = fixture();
    f.state.actors.push({ uid: 80, handcart: { trip: { source: 10, ware: "planks", planned: 1, loaded: 2, prepaid: 0 } } } as SettlementActor);
    expect(f.prepare().jobs).toEqual([]);
    f.state.actors[0]!.handcart!.trip!.planned = 10;
    expect(f.prepare().jobs).toEqual([]);
  });

  it("honors storage acceptance, connected storage membership and source ownership", () => {
    const f = fixture();
    f.home.accepts.planks = false;
    expect(f.prepare().jobs).toEqual([]);
    f.home.accepts.planks = true;
    expect(f.prepare(3600, []).jobs).toEqual([]);
    f.producer.access = { x: f.home.access.x + 20, z: f.home.access.z };
    expect(f.prepare().jobs).toEqual([]);
    f.producer.access = { ...f.home.access };
    f.producer.militaryFaction = 1;
    expect(f.prepare().jobs).toEqual([]);
    delete f.producer.militaryFaction;
    f.producer.construction = .5;
    expect(f.prepare().jobs).toEqual([]);
  });

  it("retains original ownership when capacity or the expiry cutoff prevents collection", () => {
    for (const cutoff of [false, true]) {
      const f = fixture(), prepared = f.prepare(cutoff ? .001 : 3600);
      const result = f.run(prepared, cutoff ? 1 : 3_600_000, cutoff ? 100 : 3);
      expect(result.inProgress).toEqual([]);
      prepared.apply(result.completedCycles, result.islands[0]!);
      expect(f.producer.output.planks).toBe(4);
      expect(result.islands[0]!.stock).toEqual({});
    }
  });

  it("validates all completion receipts and ownership before removing any goods", () => {
    const f = fixture(), prepared = f.prepare(), result = f.run(prepared), uid = prepared.jobs[0]!.uid;
    expect(() => prepared.apply({ [uid]: 2 }, result.islands[0]!)).toThrow("more than once");
    result.islands[0]!.received.planks = 0;
    expect(() => prepared.apply(result.completedCycles, result.islands[0]!)).toThrow("missing destination credit");
    result.islands[0]!.received.planks = 4;
    f.state.actors.push({ uid: 80, delivery: { source: 10, ware: "planks", reserved: true } } as SettlementActor);
    expect(() => prepared.apply(result.completedCycles, result.islands[0]!)).toThrow("ownership changed");
    expect(f.producer.output.planks).toBe(4);
  });
});
