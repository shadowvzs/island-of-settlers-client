import { describe, expect, it } from "vitest";

import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { replayCommandLog } from "../src/shared/settlement/command-log-replay";
import { militaryHealth } from "../src/shared/settlement/military-combat-rules";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { canonicalJson, hashText } from "../src/shared/settlement/settlement-state-hash";
import { createBalanceSimulation } from "../tools/bench/garrison-balance-harness";

/** Shift queue phase 1 (owner 2026-11-17): ground points and enemy units queued for a soldier group. */
const ENEMY = 1;
const TICK = .05;
const NEAR = 3;
const WEST = { x: 14, z: 24 };
const EAST = { x: 22, z: 24 };
const SOUTH = { x: 18, z: 28 };

const island = () => createBalanceSimulation(48, 3, { x: 6.5, z: 6.5 }, undefined,
  { withoutMilitaryCommander: true });
const run = (simulation: SettlementSimulation, ticks: number) => {
  for (let tick = 0; tick < ticks; tick++) simulation.update(TICK);
};
const combatOf = (simulation: SettlementSimulation, actor: number) =>
  simulation.militarySoldiers().find(entry => entry.actor === actor)?.combat;
const bodyOf = (simulation: SettlementSimulation, uid: number) =>
  simulation.frames().find(actor => actor.uid === uid)!;
const hashOf = (simulation: SettlementSimulation) =>
  hashText(canonicalJson({ ...simulation.saveState(), accumulator: 0 }));
const ground = (point: { x: number; z: number }, mode: "attackMove" | "move" | "retreat" = "move") =>
  ({ kind: "ground" as const, mode, ...point });
const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const allNear = (simulation: SettlementSimulation, ids: readonly number[], point: { x: number; z: number }) =>
  ids.every(id => distance(bodyOf(simulation, id), point) < NEAR);
/** Ticks until `done`, at most `limit`; returns whether it happened. */
const runUntil = (simulation: SettlementSimulation, done: () => boolean, limit = 2400) => {
  for (let tick = 0; tick < limit; tick++) {
    if (done()) return true;
    simulation.update(TICK);
  }
  return done();
};

/** Six player swordsmen standing at (18, 24): two groups of three. */
const army = () => {
  const simulation = island();
  const health = militaryHealth("shield", 0);
  simulation.receiveTroops([0, 1, 2, 3, 4, 5].map(() => ({ hp: health, rank: 0, type: "shield" as const })));
  const soldiers = simulation.militarySoldiers().map(soldier => soldier.actor);
  expect(simulation.commandMilitary(soldiers, { x: 18, z: 24 }, "move")).toBe(true);
  run(simulation, 1200);
  return { first: soldiers.slice(0, 3), second: soldiers.slice(3), simulation, soldiers };
};

describe("Shift order queue", () => {
  it("starts an idle group's first step now, appends the rest and walks them in order as one group", () => {
    const { first, simulation } = army();
    expect(simulation.queueMilitaryOrder(first, ground(WEST))).toEqual({ immediate: true, ok: true, waiting: 0 });
    expect(simulation.queueMilitaryOrder(first, ground(EAST))).toEqual({ immediate: false, ok: true, waiting: 1 });
    expect(simulation.queueMilitaryOrder(first, ground(SOUTH, "attackMove")))
      .toEqual({ immediate: false, ok: true, waiting: 2 });
    const [view] = simulation.militaryOrderQueues();
    expect(view?.members).toEqual(first);
    expect(view?.steps.map(step => [step.x, step.z])).toEqual([[14, 24], [22, 24], [18, 28]]);
    // The group reaches the west point before anyone heads east: the next step starts for all at once.
    expect(runUntil(simulation, () => first.some(id => distance(combatOf(simulation, id)?.destination ?? WEST,
      EAST) < NEAR))).toBe(true);
    for (const id of first) expect(distance(combatOf(simulation, id)!.destination!, EAST)).toBeLessThan(NEAR);
    expect(allNear(simulation, first, WEST)).toBe(true);
    expect(runUntil(simulation, () => allNear(simulation, first, SOUTH) &&
      simulation.militaryOrderQueues().length === 0)).toBe(true);
    for (const id of first) {
      expect(combatOf(simulation, id)?.queue).toBeUndefined();
      expect(combatOf(simulation, id)?.order).toBe("attackMove");
    }
  }, 120_000);

  it("a large group (the paced queued march) reaches each point before the next starts", () => {
    const simulation = island();
    const health = militaryHealth("shield", 0);
    simulation.receiveTroops(Array.from({ length: 12 }, () => ({ hp: health, rank: 0, type: "shield" as const })));
    const soldiers = simulation.militarySoldiers().map(soldier => soldier.actor);
    expect(simulation.queueMilitaryOrder(soldiers, ground(WEST)).ok).toBe(true);
    expect(simulation.queueMilitaryOrder(soldiers, ground(EAST)).ok).toBe(true);
    expect(runUntil(simulation, () => soldiers.some(id => distance(combatOf(simulation, id)?.destination ?? WEST,
      EAST) < 1), 4800)).toBe(true);
    const arrived = soldiers.filter(id => distance(bodyOf(simulation, id), WEST) < 2 * NEAR).length;
    expect(arrived * 10).toBeGreaterThanOrEqual(soldiers.length * 9);
    expect(runUntil(simulation, () => simulation.militaryOrderQueues().length === 0, 4800)).toBe(true);
    expect(soldiers.filter(id => distance(bodyOf(simulation, id), EAST) < 2 * NEAR)).toHaveLength(12);
  }, 180_000);

  it("a plain order clears the selected group's queue only; another group keeps its own", () => {
    const { first, second, simulation } = army();
    for (const point of [WEST, EAST]) {
      expect(simulation.queueMilitaryOrder(first, ground(point)).ok).toBe(true);
      expect(simulation.queueMilitaryOrder(second, ground(point === WEST ? SOUTH : WEST)).ok).toBe(true);
    }
    expect(simulation.militaryOrderQueues()).toHaveLength(2);
    expect(simulation.commandMilitary(first, SOUTH, "move")).toBe(true);
    for (const id of first) expect(combatOf(simulation, id)?.queue).toBeUndefined();
    run(simulation, 1);
    const views = simulation.militaryOrderQueues();
    expect(views).toHaveLength(1);
    expect(views[0]?.members).toEqual(second);
    // The first group finishes its plain order and stays there: nothing of the old queue resumes.
    expect(runUntil(simulation, () => allNear(simulation, first, SOUTH))).toBe(true);
    run(simulation, 200);
    expect(allNear(simulation, first, SOUTH)).toBe(true);
  }, 120_000);

  it("queues a store step after a ground step and ends the queue when the group is stored", () => {
    const { first, simulation } = army();
    const hq = simulation.headquarters.uid;
    expect(simulation.queueMilitaryOrder(first, ground(WEST)).ok).toBe(true);
    expect(simulation.queueMilitaryOrder(first, { kind: "store", building: hq, x: 0, z: 0 }))
      .toEqual({ immediate: false, ok: true, waiting: 1 });
    expect(simulation.militaryOrderQueues()[0]?.steps.at(-1)?.kind).toBe("store");
    const saved = simulation.saveState();
    expect(saved.military?.orderQueues?.[0]?.pending[0]).toMatchObject({ kind: "store", building: hq });
    expect(island().loadState(saved).ok).toBe(true);
    expect(runUntil(simulation, () => simulation.militaryOrderQueues().length === 0, 4800)).toBe(true);
    for (const id of first) expect(combatOf(simulation, id)?.returnToStorage).not.toBe(true);
  }, 120_000);

  it("queues a garrison step and ends when the soldiers are stationed", () => {
    const simulation = island();
    simulation.receiveTroops([0, 1].map(() => ({ hp: militaryHealth("shield", 0), rank: 0, type: "shield" as const })));
    const site = simulation.placeBuilding(1, 12, 18).building!;
    site.construction = 1; site.required = {};
    expect(simulation.connectRoads(simulation.headquarters.access, site.access)).toBe(true);
    const ids = simulation.militarySoldiers().map(soldier => soldier.actor);
    expect(simulation.queueMilitaryOrder(ids,
      { kind: "garrison", building: site.uid, x: site.access.x, z: site.access.z }).ok).toBe(true);
    expect(runUntil(simulation, () => simulation.militaryOrderQueues().length === 0, 4800)).toBe(true);
    expect(simulation.militaryBuildings().find(building => building.uid === site.uid)?.stationed).toBe(2);
  }, 120_000);

  it("a busy group keeps its current order and queues the step after it", () => {
    const { first, simulation } = army();
    expect(simulation.commandMilitary(first, WEST, "move")).toBe(true);
    expect(simulation.queueMilitaryOrder(first, ground(EAST))).toEqual({ immediate: false, ok: true, waiting: 1 });
    for (const id of first) expect(distance(combatOf(simulation, id)!.destination!, WEST)).toBeLessThan(NEAR);
    expect(runUntil(simulation, () => allNear(simulation, first, EAST))).toBe(true);
  }, 120_000);

  it("a queued target is chased when its turn comes; once it dies the group moves on", () => {
    const { first, simulation } = army();
    const enemy = simulation.spawnMilitaryOpponent({ x: 26, z: 24 }, "shield", 0, ENEMY)!;
    expect(enemy).not.toBeNull();
    expect(simulation.queueMilitaryOrder(first, ground(WEST)).ok).toBe(true);
    expect(simulation.queueMilitaryOrder(first, { kind: "target", uid: enemy, x: 26, z: 24 }).ok).toBe(true);
    expect(simulation.queueMilitaryOrder(first, ground(SOUTH)).ok).toBe(true);
    for (const id of first) expect(combatOf(simulation, id)?.chase).toBeUndefined();
    expect(runUntil(simulation, () => first.some(id => combatOf(simulation, id)?.chase?.uid === enemy))).toBe(true);
    // The chase starts only once the whole group reached the first point.
    expect(allNear(simulation, first, WEST)).toBe(true);
    expect(runUntil(simulation, () => !combatOf(simulation, enemy), 4800)).toBe(true);
    const alive = first.filter(id => combatOf(simulation, id));
    expect(runUntil(simulation, () => allNear(simulation, alive, SOUTH), 4800)).toBe(true);
    // A target already gone when its turn comes is skipped.
    expect(simulation.queueMilitaryOrder(alive, ground(WEST)).ok).toBe(true);
    expect(simulation.queueMilitaryOrder(alive, { kind: "target", uid: enemy, x: 26, z: 24 }).ok).toBe(true);
    expect(simulation.queueMilitaryOrder(alive, ground(EAST)).ok).toBe(true);
    expect(runUntil(simulation, () => allNear(simulation, alive, EAST), 4800)).toBe(true);
  }, 180_000);

  it("refuses malformed steps and a full queue", () => {
    const { first, simulation } = army();
    expect(simulation.queueMilitaryOrder(first, { kind: "siege", uid: 1, x: 1, z: 1 } as never))
      .toEqual({ ok: false, reason: "invalidStep" });
    expect(simulation.queueMilitaryOrder(first, ground({ x: Number.NaN, z: 1 })))
      .toEqual({ ok: false, reason: "invalidStep" });
    expect(simulation.queueMilitaryOrder(first, ground(WEST)).ok).toBe(true);
    for (let step = 0; step < 16; step++) expect(simulation.queueMilitaryOrder(first, ground(EAST)).ok).toBe(true);
    expect(simulation.queueMilitaryOrder(first, ground(EAST))).toEqual({ ok: false, reason: "queueFull" });
  }, 60_000);

  it("save validation refuses a member of a missing queue and a malformed queue", () => {
    const { first, simulation } = army();
    expect(simulation.queueMilitaryOrder(first, ground(WEST)).ok).toBe(true);
    const orphan = structuredClone(simulation.saveState());
    orphan.military!.orderQueues = [];
    expect(island().loadState(orphan).ok).toBe(false);
    const malformed = structuredClone(simulation.saveState());
    malformed.military!.orderQueues![0]!.pending = [{ kind: "ground", mode: "fly", x: 1, z: 1 } as never];
    expect(island().loadState(malformed).ok).toBe(false);
  }, 60_000);

  it("is recorded: the replay and a reload mid-queue reach the same state hash", () => {
    const { first, simulation } = army();
    const replica = island();
    expect(replica.loadState(structuredClone(simulation.saveState())).ok).toBe(true);
    const recorder = createCommandLogRecorder(simulation, { sourceVersion: "test" });
    recorder.open();
    for (const point of [WEST, EAST, SOUTH]) expect(simulation.queueMilitaryOrder(first, ground(point)).ok).toBe(true);
    run(simulation, 120);
    const interval = recorder.close("home")!;
    expect(interval.entries.map(entry => entry.command.name)).toContain("queueMilitaryOrder");
    expect(replayCommandLog(replica, interval)).toEqual({ endChecksum: interval.endChecksum, ok: true });
    expect(hashOf(replica)).toBe(hashOf(simulation));
    const saved = structuredClone(simulation.saveState());
    expect(saved.military?.orderQueues).toHaveLength(1);
    expect(saved.military?.soldiers.filter(soldier => soldier.combat?.queue !== undefined)).toHaveLength(3);
    const reloaded = island();
    expect(reloaded.loadState(saved).ok).toBe(true);
    // Both go on through the remaining steps (the advance to the next point included) tick for tick.
    run(simulation, 900);
    run(reloaded, 900);
    expect(hashOf(reloaded)).toBe(hashOf(simulation));
    expect(allNear(simulation, first, SOUTH)).toBe(true);
  }, 180_000);
});
