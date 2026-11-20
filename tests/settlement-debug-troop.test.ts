import { describe, expect, it } from "vitest";

import { soldierSpawnMessage, troopGrantMessage } from "../src/app/settlement/debug-tool-messages";
import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { replayCommandLog } from "../src/shared/settlement/command-log-replay";
import { militaryHealth } from "../src/shared/settlement/military-combat-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { randomDebugTroop } from "../src/shared/settlement/settlement-debug-troop";
import { MAX_SOLDIER_RANK } from "../src/shared/settlement/settlement-military-ranks";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { TAVERN_TROOPS } from "../src/shared/settlement/tavern-rules";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const createWorld = () => {
  const size = 48;
  return { seed: 3, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 8, z: 8 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array() }
  } as unknown as WorldData;
};

const fixture = () => {
  const world = createWorld();
  const roads = createRoadNetwork(world, { isBlocked: () => false });
  return createSettlementSimulation({ initialSettlers: 20, initialStock: {}, resourceTargets: () => [], roads, world });
};

const storedCount = (simulation: ReturnType<typeof fixture>, type: string) =>
  simulation.militaryStoredTroops().find(entry => entry.type === type)?.count ?? 0;

describe("development tool: spawn a random field soldier", () => {
  it.each(TAVERN_TROOPS)("spawns a full-health %s at the clicked clear ground", type => {
    const simulation = fixture(), point = { x: 20.5, z: 20.5 };
    const spawn = simulation.spawnDebugSoldier(point, { rank: 2, type })!;
    expect(spawn).toMatchObject({ rank: 2, type });
    const actor = simulation.frames().find(actor => actor.uid === spawn.id)!;
    expect(actor).toMatchObject({ phase: "militaryField", visible: true });
    expect(actor.x).toBeCloseTo(point.x);
    expect(actor.z).toBeCloseTo(point.z);
    const soldier = simulation.militarySoldiers().find(entry => entry.actor === spawn.id)!;
    expect(soldier).toMatchObject({ rank: 2, combat: { faction: 0, hp: militaryHealth(type, 2), type } });
    expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
  });

  it("uses a seeded random type/rank by default and rejects invalid choices", () => {
    const simulation = fixture();
    const first = simulation.spawnDebugSoldier({ x: 20.5, z: 20.5 })!;
    expect(TAVERN_TROOPS).toContain(first.type);
    expect(first.rank).toBeGreaterThanOrEqual(0);
    expect(first.rank).toBeLessThanOrEqual(MAX_SOLDIER_RANK);
    expect(simulation.spawnDebugSoldier({ x: 24.5, z: 24.5 }, { rank: MAX_SOLDIER_RANK + 1, type: "shield" }))
      .toBeNull();
  });

  it("names the spawned soldier in the notice", () => {
    expect(soldierSpawnMessage({ id: 4, rank: 1, type: "archer" }, "roman"))
      .toEqual({ text: "Archer (rank 2) spawned at the clicked ground.", warning: false });
    expect(soldierSpawnMessage(null, "roman")).toMatchObject({ warning: true });
  });
});

describe("development tool: add a random military unit to the HQ", () => {
  it("rolls from the seeded, saved military stream: the same island grants the same troops", () => {
    const first = fixture(), second = fixture();
    const grants = (simulation: ReturnType<typeof fixture>) =>
      [simulation.grantDebugTroop(), simulation.grantDebugTroop(), simulation.grantDebugTroop()];
    expect(grants(second)).toEqual(grants(first));
    expect(second.saveState().military).toEqual(first.saveState().military);
  });

  it("picks a recruitable troop type and a valid rank", () => {
    for (const roll of [0, .3, .6, .99]) {
      const { rank, type } = randomDebugTroop(() => roll);
      expect(TAVERN_TROOPS).toContain(type);
      expect(rank).toBeGreaterThanOrEqual(0);
      expect(rank).toBeLessThanOrEqual(MAX_SOLDIER_RANK);
    }
  });

  it.each(TAVERN_TROOPS)("stores a %s as a full-health reserve in the headquarters", type => {
    const simulation = fixture();
    const before = storedCount(simulation, type);
    const grant = simulation.grantDebugTroop({ rank: 2, type })!;
    expect(grant).toMatchObject({ rank: 2, type });
    expect(storedCount(simulation, type)).toBe(before + 1);
    const soldier = simulation.saveState().military!.soldiers.find(entry => entry.actor === grant.id)!;
    expect(soldier).toMatchObject({ rank: 2, combat: { faction: 0, hp: militaryHealth(type, 2), type } });
    expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
  });

  it("uses a random choice by default and rejects invalid ones", () => {
    const simulation = fixture();
    expect(simulation.grantDebugTroop()).toMatchObject({ rank: expect.any(Number), type: expect.any(String) });
    expect(simulation.grantDebugTroop({ rank: MAX_SOLDIER_RANK + 1, type: "shield" })).toBeNull();
  });

  it("names the soldier in the notice", () => {
    expect(troopGrantMessage({ id: 4, rank: 1, type: "archer" }, "roman").warning).toBe(false);
    expect(troopGrantMessage(null, "roman")).toMatchObject({ warning: true });
  });
});

describe("debug spawns use ordinary military orders", () => {
  it("preserves admitted troops and raid orders across save/load and authorized recorded replay", () => {
    const simulation = fixture();
    const base = structuredClone(simulation.saveState());
    const recorder = createCommandLogRecorder(simulation, { sourceVersion: "test" });
    recorder.open();
    simulation.spawnDebugSoldier({ x: 20.5, z: 20.5 }, { rank: 2, type: "shield" });
    simulation.spawnDebugEnemy({ x: 30.5, z: 20.5 }, { rank: 1, type: "archer" });
    for (let tick = 0; tick < 60; tick++) simulation.update(.05);
    const interval = recorder.close("home")!, saved = structuredClone(simulation.saveState());
    const replay = fixture();
    expect(replay.loadState(base)).toEqual({ ok: true });
    expect(replayCommandLog(replay, interval, { rejectDebug: false })).toEqual({ ok: true,
      endChecksum: interval.endChecksum });
    expect(replayCommandLog(fixture(), interval)).toMatchObject({ ok: false,
      mismatch: { kind: "invalid", reason: "Rejected command spawnDebugSoldier" } });
    const restored = fixture();
    expect(restored.loadState(saved)).toEqual({ ok: true });
    expect(restored.saveState().military).toEqual(saved.military);
    recorder.dispose();
  });
  it("walks a friendly field recruit to storage and becomes a normal reserve without teleporting", () => {
    const simulation = fixture(), point = { x: 20.5, z: 20.5 };
    const spawn = simulation.spawnDebugSoldier(point, { rank: 2, type: "shield" })!;
    expect(simulation.militarySoldiers().find(soldier => soldier.actor === spawn.id)?.combat)
      .toMatchObject({ order: "attackMove", returnToStorage: true,
        returnStorageUid: simulation.headquarters.uid });
    for (let tick = 0; tick < 20; tick++) simulation.update(.05);
    const walking = simulation.frames().find(actor => actor.uid === spawn.id)!;
    expect(Math.hypot(walking.x - point.x, walking.z - point.z)).toBeGreaterThan(.1);
    expect(Math.hypot(walking.x - point.x, walking.z - point.z)).toBeLessThan(4);
    for (let tick = 0; tick < 2400; tick++) simulation.update(.05);
    expect(simulation.frames().find(actor => actor.uid === spawn.id))
      .toMatchObject({ phase: "militaryReserve", visible: false, building: simulation.headquarters.uid });
    expect(storedCount(simulation, "shield")).toBe(1);
  });

  it("lets an explicit player order replace automatic storage admission", () => {
    const simulation = fixture();
    const spawn = simulation.spawnDebugSoldier({ x: 20.5, z: 20.5 }, { rank: 1, type: "shield" })!;
    expect(simulation.commandMilitary([spawn.id], { x: 30.5, z: 30.5 }, "move")).toBe(true);
    expect(simulation.militarySoldiers().find(soldier => soldier.actor === spawn.id)?.combat)
      .toMatchObject({ order: "move", returnToStorage: undefined });
  });

  it("fights nearby enemies through ordinary field targeting while joining storage", () => {
    const simulation = fixture();
    const friendly = simulation.spawnDebugSoldier({ x: 20.5, z: 20.5 }, { rank: 2, type: "heavy" })!;
    const enemy = simulation.spawnDebugEnemy({ x: 23.5, z: 20.5 }, { rank: 0, type: "shield" })!;
    let fought = false;
    for (let tick = 0; tick < 500; tick++) {
      simulation.update(.05);
      const troops = simulation.militarySoldiers();
      const friend = troops.find(soldier => soldier.actor === friendly.id);
      const foe = troops.find(soldier => soldier.actor === enemy.id);
      if (!foe || !friend || foe.combat!.hp < militaryHealth("shield", 0) ||
        friend.combat!.hp < militaryHealth("heavy", 2)) { fought = true; break; }
    }
    expect(fought).toBe(true);
  });

  it("gives a debug enemy a regular raid objective without a scenario order", () => {
    const simulation = fixture();
    const spawn = simulation.spawnDebugEnemy({ x: 30.5, z: 30.5 }, { rank: 1, type: "heavy" })!;
    const soldier = simulation.militarySoldiers().find(soldier => soldier.actor === spawn.id)!;
    expect(soldier.combat!.destination || soldier.combat!.siege !== undefined).toBeTruthy();
    for (let tick = 0; tick < 100; tick++) simulation.update(.05);
    const actor = simulation.frames().find(actor => actor.uid === spawn.id)!;
    expect(Math.hypot(actor.x - spawn.point.x, actor.z - spawn.point.z)).toBeGreaterThan(1);
    expect(actor).toMatchObject({ job: "Soldier", visible: true });
  });
});
