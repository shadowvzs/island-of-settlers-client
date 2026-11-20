import { describe, expect, it } from "vitest";

import { type OfflineEconomyJob, runOfflineEconomyEvents } from "../src/app/settlement/offline-economy-events";
import { prepareOfflineEconomyInputs } from "../src/app/settlement/offline-economy-inputs";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";
import { huntingWorld } from "./helpers/hunting-world";

const fixture = () => {
  const world = huntingWorld(), simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world) });
  const state = simulation.saveState(), home = state.buildings[0]!;
  const foundry = { ...structuredClone(home), uid: 10, typeId: 26, input: { ironOre: 2, coal: 2 } };
  state.buildings.push(foundry);
  const save = { settlement: state } as GameSaveV1;
  const job: OfflineEconomyJob = { uid: "building:10", islandId: "home", cycleTicks: 5, endTick: 20,
    inputs: { ironOre: 1, coal: 1 }, outputs: { iron: 1 }, inputTargets: { ironOre: 2, coal: 2 } };
  const prepare = () => prepareOfflineEconomyInputs(save, "home", [job]);
  const run = (horizonTicks = 20, capacity = 10, extras: OfflineEconomyJob[] = []) =>
    runOfflineEconomyEvents({ horizonTicks, islands: [{ islandId: "home", stock: {}, capacities: { iron: capacity } }],
      jobs: [{ ...job, uid: "home:building:10" }, ...extras] });
  const actor: SettlementActor = { uid: 80, x: 0, y: 0, z: 0, yaw: 0, visible: true, phase: "inputApproach",
    job: "Iron founder", action: "walk", ware: null, building: 10, home: home.uid,
    path: [], pathIndex: 0, timer: 0, animationTime: 0 };
  return { actor, foundry, job, prepare, run, save, state };
};

describe("offline existing private input buffers", () => {
  it("uses the foundry's real ore and coal once without exposing them to another consumer", () => {
    const f = fixture(), prepared = f.prepare(), original = JSON.stringify(f.save);
    const thief = { ...f.job, uid: "thief", initialInputs: undefined, outputs: { other: 1 } };
    const result = f.run(20, 10, [thief]), ledger = result.islands[0]!;
    expect(JSON.stringify(f.save)).toBe(original);
    expect(ledger.produced).toEqual({ iron: 2 });
    expect(ledger.consumed).toEqual({ ironOre: 2, coal: 2 });
    expect(ledger.received).toEqual({});
    prepared.apply(result.buffers);
    expect(f.foundry.input).toEqual({ ironOre: 0, coal: 0 });
    expect(() => prepared.apply(result.buffers)).toThrow("already applied");
    f.prepare();
    expect(f.job.initialInputs).toBeUndefined();
  });

  it("retains private inputs if their cycle cannot finish or its output cannot fit", () => {
    for (const [horizon, capacity] of [[3, 10], [20, 0]]) {
      const f = fixture(), prepared = f.prepare(), before = JSON.stringify(f.save);
      const result = f.run(horizon, capacity);
      expect(result.inProgress).toEqual([]);
      prepared.apply(result.buffers);
      expect(JSON.stringify(f.save)).toBe(before);
    }
  });

  it("leaves an original worker's planned inputs and input-export claims outside the model", () => {
    for (const kind of ["worker", "export"]) {
      const f = fixture();
      if (kind === "worker") f.actor.productionInputs = ["coal"];
      else f.actor.delivery = { source: 10, destination: 0, ware: "ironOre", sourceInput: true };
      f.state.actors.push(f.actor);
      f.prepare();
      expect(f.job.initialInputs).toBeUndefined();
      expect(f.run().islands[0]!.produced).toEqual({});
    }
  });

  it("validates leftover amounts before changing the native buffer", () => {
    const f = fixture(), prepared = f.prepare(), result = f.run(), before = JSON.stringify(f.save);
    result.buffers[0]!.ownedStock!.coal = 3;
    expect(() => prepared.apply(result.buffers)).toThrow("owned input balance changed");
    expect(JSON.stringify(f.save)).toBe(before);
  });

  it("uses existing alternative food before requesting another food", () => {
    const inputs: Record<string, number>[] = [];
    const result = runOfflineEconomyEvents({ horizonTicks: 2,
      islands: [{ islandId: "home", stock: { "~ore": 2, fish: 1 } }],
      jobs: [{ uid: "mine", islandId: "home", cycleTicks: 1, endTick: 2, inputs: { "~ore": 1 },
        outputs: { ironOre: 1 }, alternativeFoods: ["fish", "meat"], inputTargets: { fish: 1, meat: 1 },
        initialInputs: { meat: 1 } }], onCompleted: (_job, _tick, consumed) => inputs.push({ ...consumed }) });
    expect(inputs).toEqual([{ "~ore": 1, meat: 1 }, { "~ore": 1, fish: 1 }]);
    expect(result.islands[0]!.produced.ironOre).toBe(2);
  });
});
