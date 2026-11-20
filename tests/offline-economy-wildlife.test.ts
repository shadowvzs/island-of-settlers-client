import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { stageGameSession } from "../src/app/settlement/game-session";
import { runOfflineEconomyEvents } from "../src/app/settlement/offline-economy-events";
import { prepareOfflineEconomyWildlife } from "../src/app/settlement/offline-economy-wildlife";
import { createAnimalManager } from "../src/render-common/wildlife/animal-manager";
import { validateAnimalSave } from "../src/render-common/wildlife/manager/animal-save";
import { createIslandNav } from "../src/render-common/wildlife/nav/island-nav";
import { SPECIES } from "../src/render-common/wildlife/wildlife-species";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";
import { huntingWorld } from "./helpers/hunting-world";

const fixture = (age = 1) => {
  const world = huntingWorld(), animals = createAnimalManager(world, createIslandNav(world, []));
  if (!animals.placeAnimal(SPECIES.deer, 30, 30, age)) throw new Error("fixture animal placement");
  const id = animals.debug.pool.active.findIndex(active => active === 1);
  animals.debug.pool.pending[id] = 0; animals.debug.pool.appear[id] = 1;
  const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world), initialSettlers: 20 });
  const state = simulation.saveState();
  const building = { ...structuredClone(state.buildings[0]!), uid: 10, typeId: 22, worker: 77,
    x: 26, z: 30, access: { x: 26, z: 31 }, workerApproach: { x: 26, z: 31 }, inventory: {}, input: {}, output: {} };
  state.buildings.push(building);
  state.actors.push({ uid: 77, building: 10, home: 0, job: "Hunter", phase: "inside", ware: null } as SettlementActor);
  const save = { settlement: state, runtime: { animals: animals.saveState() }, savedAt: 1000 } as GameSaveV1;
  return { save, world, animals, id, building };
};
const execute = (plan: ReturnType<typeof prepareOfflineEconomyWildlife>, horizonTicks: number) =>
  runOfflineEconomyEvents({ horizonTicks, islands: [{ islandId: "home", stock: plan.stock }], jobs: plan.jobs });

describe("native offline wildlife lifecycle and finite hunting", () => {
  it("requires an actual killed, fallen and collected adult before delivering finite meat", () => {
    const f = fixture(), before = JSON.stringify(f.save);
    const plan = prepareOfflineEconomyWildlife(f.save, f.world, 120);
    expect(plan.hunts).toHaveLength(1);
    expect(plan.jobs).toHaveLength(1);
    const hunt = plan.hunts[0]!;
    expect(hunt.killedSeconds).toBeGreaterThan(hunt.acquiredSeconds);
    expect(hunt.deliveredSeconds).toBeGreaterThan(hunt.killedSeconds + 2);
    expect(hunt.deliveredSeconds - hunt.acquiredSeconds).toBeGreaterThanOrEqual(hunt.walkDistance / hunt.walkSpeed);
    expect(hunt.walkDistance).toBeGreaterThan(0);
    expect(JSON.stringify(f.save)).toBe(before);
    const early = execute(plan, plan.jobs[0]!.endTick! - 1);
    expect(early.islands[0]!.produced.meat ?? 0).toBe(0);
    const complete = execute(plan, 120_000);
    expect(complete.islands[0]!.produced.meat).toBe(1);
    plan.apply(complete.completedCycles, complete.islands[0]!);
    expect(() => validateAnimalSave((f.save.runtime as { animals: typeof plan.animals }).animals!)).not.toThrow();
    expect(() => plan.apply(complete.completedCycles, complete.islands[0]!)).toThrow("already applied");
  });
  it("does not credit immature animals or bodies waiting to respawn", () => {
    const young = fixture(0);
    expect(prepareOfflineEconomyWildlife(young.save, young.world, 10).hunts).toEqual([]);
    const dead = fixture();
    dead.animals.killAnimal(dead.id);
    (dead.save.runtime as { animals: ReturnType<typeof dead.animals.saveState> }).animals = dead.animals.saveState();
    expect(prepareOfflineEconomyWildlife(dead.save, dead.world, 200).hunts).toEqual([]);
    const renewed = prepareOfflineEconomyWildlife(dead.save, dead.world, 450);
    // A placed animal with no forest habitat never respawns: a timer must not invent trees.
    expect(renewed.animals!.spawner.births).toBe(dead.animals.saveState().spawner.births);
    expect(renewed.hunts).toEqual([]);
  });
  // Retired: public/demo/continued-0.json is version 1; current policy rejects it. A developed v2 fixture is needed.
  it.skip("advances real saved forest respawns and validates their native pool/RNG continuation", async () => {
    const save = JSON.parse(readFileSync(new URL("../public/demo/continued-0.json", import.meta.url), "utf8")) as GameSaveV1;
    const loaded = await stageGameSession(save);
    const before = (save.runtime as { animals: ReturnType<typeof createAnimalManager>["saveState"] extends () => infer S ? S : never }).animals;
    const plan = prepareOfflineEconomyWildlife(save, loaded.map.world, 450);
    expect(plan.animals!.spawner.births).toBeGreaterThan(before.spawner.births);
    expect(plan.animals!.time).toBeCloseTo(before.time + 450);
    expect(() => validateAnimalSave(plan.animals!)).not.toThrow();
  });
  it("retains prey owned by another saved hunter", () => {
    const f = fixture();
    f.save.settlement.actors.push({ uid: 88, target: { id: f.id, kind: "wildlife", x: 30, z: 30 } } as SettlementActor);
    expect(prepareOfflineEconomyWildlife(f.save, f.world, 120).hunts).toEqual([]);
  });
  it("discards an unfinished final attempt from its population and RNG checkpoint", () => {
    const f = fixture(), plan = prepareOfflineEconomyWildlife(f.save, f.world, 5);
    expect(plan.hunts).toEqual([]);
    const { pool } = createAnimalManager(f.world, createIslandNav(f.world, []), plan.animals).debug;
    expect(pool.active[f.id]).toBe(1);
    expect(pool.health[f.id]).toBe(1);
    expect(plan.notes.join(" ")).toContain("checkpoint");
    expect(() => validateAnimalSave(plan.animals!)).not.toThrow();
  });
  it("keeps an unaccepted warehouse award on the hunter's shelf", () => {
    const f = fixture(), plan = prepareOfflineEconomyWildlife(f.save, f.world, 120);
    const ledger = { islandId: "home", stock: {}, produced: {}, consumed: {}, sent: {}, received: {} };
    plan.apply({}, ledger);
    expect(f.building.output).toEqual({ meat: 1 });
    expect(ledger.produced).toEqual({ meat: 1 });
  });
  it("fails before commit if deferred output cannot fit the real shelf", () => {
    const f = fixture(), plan = prepareOfflineEconomyWildlife(f.save, f.world, 120);
    f.building.output = { meat: 6 };
    const before = JSON.stringify(f.save);
    expect(() => plan.apply({}, { islandId: "home", stock: {}, produced: {}, consumed: {}, sent: {}, received: {} }))
      .toThrow("capacity");
    expect(JSON.stringify(f.save)).toBe(before);
  });
  it("uses deterministic native RNG for a given coarse regime", () => {
    const f = fixture();
    const first = prepareOfflineEconomyWildlife(f.save, f.world, 120, { stepSeconds: 1 });
    const second = prepareOfflineEconomyWildlife(f.save, f.world, 120, { stepSeconds: 1 });
    expect(first.animals).toEqual(second.animals);
    expect(first.hunts).toEqual(second.hunts);
    expect(() => prepareOfflineEconomyWildlife(f.save, f.world, 20, { stepSeconds: 0 })).toThrow("step");
    expect(() => prepareOfflineEconomyWildlife(f.save, f.world, -1)).toThrow("horizon");
  });
  it("preserves completed hunt prefixes across longer horizons in the same coarse regime", () => {
    const f = fixture();
    const short = prepareOfflineEconomyWildlife(f.save, f.world, 120);
    const long = prepareOfflineEconomyWildlife(f.save, f.world, 240);
    expect(long.hunts.filter(hunt => hunt.deliveredSeconds <= 120)).toEqual(short.hunts);
    for (const hunt of long.hunts)
      expect(hunt.deliveredSeconds - hunt.acquiredSeconds).toBeGreaterThanOrEqual(hunt.walkDistance / hunt.walkSpeed);
    // This checks completed-prefix causality, not equality of population states at different times.
    expect(long.animals!.time).toBeCloseTo(short.animals!.time + 120);
  });
});
