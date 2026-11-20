import { describe, expect, it } from "vitest";

import { COMMANDER_INPUT_BUTTON, type CommanderInput } from "../../island-of-settlers-shared/src/commander-input";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { replayCommandLog } from "../src/shared/settlement/command-log-replay";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./helpers/hunting-world";

const deployed = () => {
  const world = huntingWorld(), roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({ clockStart: 0, developmentAllowed: true,
    initialSettlers: 20, playerLevel: () => 23, roads, world,
    initialStock: { beer: 40, coins: 40, wine: 40, planks: 40, shield: 6, stone: 40, sword: 6 } });
  const [width, depth] = getBuildingDefinition(62).gridFootprint;
  const placed = simulation.placeBuilding(62, 26 + width / 2, 22 + depth / 2);
  if (!placed.ok || !placed.building) throw new Error(placed.reason);
  Object.assign(placed.building, { construction: 1, foundationProgress: 1, required: {} });
  roads.addRoad(simulation.headquarters.access, placed.building.access);
  expect(simulation.recruitCommander(placed.building.uid).ok).toBe(true);
  const saved = simulation.saveState(), soldier = saved.military!.soldiers.find(row => row.commanderId)!;
  const actor = saved.actors.find(row => row.uid === soldier.actor)!;
  Object.assign(actor, { phase: "militaryField", visible: true, mounted: true, x: 40, z: 40, yaw: 0 });
  soldier.building = -3;
  saved.military!.commander!.location = "field";
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  const body = () => simulation.frames().find(row => row.uid === soldier.actor)!;
  const state = () => simulation.militarySoldiers().find(row => row.actor === soldier.actor)!;
  const begin = () => {
    const result = simulation.beginCommanderControl(soldier.actor);
    if (!result.ok) throw new Error(result.reason);
    return result.generation;
  };
  const input = (generation: number, patch: Partial<CommanderInput> = {}) => simulation.submitCommanderInput({
    generation, forward: 0, right: 0, heading: 0, pitch: 0, buttons: 0, ...patch });
  return { begin, body, input, saved, simulation, soldier, state, world };
};

describe("real commander direct-control domain", () => {
  it("owns only the existing commander and preserves HP, actor/horse IDs and ordinary cooldown", () => {
    const f = deployed(), before = f.simulation.saveState();
    expect(f.simulation.beginCommanderControl(f.soldier.actor + 100_000).ok).toBe(false);
    const generation = f.begin();
    expect(f.simulation.beginCommanderControl(f.soldier.actor).ok).toBe(false);
    expect(f.simulation.commanderControlSnapshot()).toMatchObject({ actor: f.soldier.actor,
      commanderId: f.soldier.commanderId, hp: f.state().combat!.hp, generation, mounted: true });
    expect(f.simulation.endCommanderControl(generation + 1)).toBe(false);
    expect(f.simulation.endCommanderControl(generation)).toBe(true);
    const after = f.simulation.saveState();
    expect(after.actors.map(actor => actor.uid)).toEqual(before.actors.map(actor => actor.uid));
    expect(f.state().combat!.mount).toBe(f.soldier.combat!.mount);
    expect(f.state().combat!.cooldown).toBe(f.soldier.combat!.cooldown);
  });

  it("moves through canonical steering at the real profile speed and expires stale input", () => {
    const f = deployed(), generation = f.begin(), start = { x: f.body().x, z: f.body().z };
    for (let tick = 0; tick < 20; tick++) {
      f.simulation.update(.05);
      expect(f.input(generation, { forward: 127 })).toBe(true);
    }
    const distance = Math.hypot(f.body().x - start.x, f.body().z - start.z);
    expect(distance).toBeGreaterThan(.5);
    expect(distance).toBeLessThanOrEqual(3.6 + 1e-6);
    for (let tick = 0; tick < 12; tick++) f.simulation.update(.05);
    expect(f.simulation.commanderControlSnapshot()).toBeNull();
    expect(f.input(generation, { forward: 127 })).toBe(false);
    expect(f.body().path).toEqual([]);
  });

  it("dismounts and calls the same physical horse, survives a snapshot and never duplicates it", () => {
    const f = deployed(), generation = f.begin(), mount = f.state().combat!.mount!;
    f.simulation.update(.05);
    expect(f.input(generation, { buttons: COMMANDER_INPUT_BUTTON.dismount })).toBe(true);
    f.simulation.update(.05);
    expect(f.body().mounted).toBe(false);
    expect(f.simulation.frames().find(actor => actor.uid === mount)?.visible).toBe(true);
    const saved = f.simulation.saveState();
    expect(f.simulation.loadState(structuredClone(saved))).toEqual({ ok: true });
    expect(f.simulation.frames().filter(actor => actor.uid === mount)).toHaveLength(1);
    expect(f.input(generation, { buttons: COMMANDER_INPUT_BUTTON.callHorse })).toBe(true);
    for (let tick = 0; tick < 40 && !f.body().mounted; tick++) {
      f.simulation.update(.05);
      f.input(generation);
    }
    expect(f.body().mounted).toBe(true);
    expect(f.state().combat!.mount).toBe(mount);
    expect(f.simulation.frames().find(actor => actor.uid === mount)?.visible).toBe(false);
    expect(f.simulation.frames().filter(actor => actor.uid === mount)).toHaveLength(1);
  });

  it("records real movement in v2 and reproduces complete commander state from the actual base", () => {
    const f = deployed(), base = f.simulation.saveState();
    const recorder = createCommandLogRecorder(f.simulation, { sourceVersion: "abc123" });
    recorder.open();
    const generation = f.begin();
    for (let tick = 0; tick < 30; tick++) {
      f.simulation.update(.05);
      expect(f.input(generation, { forward: 127,
        buttons: tick >= 5 && tick < 18 ? COMMANDER_INPUT_BUTTON.block : 0 })).toBe(true);
    }
    f.simulation.endCommanderControl(generation);
    const log = recorder.close("home")!, expected = f.simulation.saveState();
    expect(log.version).toBe(2); expect(log.gaps).toBeUndefined();
    const replay = deployed();
    expect(replay.simulation.loadState(base)).toEqual({ ok: true });
    expect(replayCommandLog(replay.simulation, log)).toMatchObject({ ok: true });
    expect(replay.simulation.saveState()).toEqual(expected);
    recorder.dispose();
  });

  it("halves an actual frontal blow during guard and preserves a rear blow", () => {
    const damage = (block: boolean, side: number) => {
      const f = deployed(), generation = f.begin();
      f.simulation.update(.05);
      const enemy = f.simulation.spawnMilitaryOpponent({ x: 40, z: 40 + .7 * side }, "shield");
      expect(enemy).not.toBeNull();
      const saved = f.simulation.saveState();
      const opponent = saved.military!.soldiers.find(row => row.actor === enemy)!;
      Object.assign(opponent.combat!, { attackTime: .19, cooldown: 1, pendingTarget: f.soldier.actor });
      expect(f.simulation.loadState(saved)).toEqual({ ok: true });
      const hp = f.state().combat!.hp;
      f.input(generation, { buttons: block ? COMMANDER_INPUT_BUTTON.block : 0 });
      f.simulation.update(.05);
      return hp - f.state().combat!.hp;
    };
    const front = damage(false, 1), rear = damage(false, -1);
    expect(front).toBeGreaterThan(0); expect(rear).toBeGreaterThan(0);
    expect(damage(true, 1)).toBeCloseTo(front / 2, 8);
    expect(damage(true, -1)).toBeCloseTo(rear, 8);
  });

  it("keeps manual guard finite while held and retains recovery through re-entry", () => {
    const f = deployed(), guard = () => f.simulation.saveState().military!.combat!.directControl!;
    const generation = f.begin();
    f.simulation.update(.05);
    expect(f.input(generation, { buttons: COMMANDER_INPUT_BUTTON.block })).toBe(true);
    f.simulation.update(.05);
    expect(guard().guard).toBeCloseTo(.5); expect(guard().guardRecovery).toBeCloseTo(2);
    for (let tick = 0; tick < 10; tick++) {
      f.input(generation, { buttons: COMMANDER_INPUT_BUTTON.block }); f.simulation.update(.05);
    }
    expect(guard().guard).toBe(0); expect(guard().guardRecovery).toBeGreaterThan(1);
    const recovery = guard().guardRecovery;
    f.simulation.endCommanderControl(generation);
    const next = f.begin(); f.simulation.update(.05);
    expect(f.input(next, { buttons: COMMANDER_INPUT_BUTTON.block })).toBe(true);
    f.simulation.update(.05);
    expect(guard().guard).toBe(0); expect(guard().guardRecovery).toBeCloseTo(recovery - .1);
    for (let tick = 0; tick < 45; tick++) {
      f.input(next, { buttons: COMMANDER_INPUT_BUTTON.block }); f.simulation.update(.05);
    }
    expect(guard().guard).toBe(0); expect(guard().guardRecovery).toBe(0);
    f.input(next); f.simulation.update(.05);
    f.input(next, { buttons: COMMANDER_INPUT_BUTTON.block }); f.simulation.update(.05);
    expect(guard().guard).toBeCloseTo(.5);
  });

});
