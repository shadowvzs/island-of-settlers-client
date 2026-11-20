import { expect, it } from "vitest";

import { COMMANDER_INPUT_BUTTON } from "../../island-of-settlers-shared/src/commander-input";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { replayCommandLog } from "../src/shared/settlement/command-log-replay";
import { militaryManualBowOrigin } from "../src/shared/settlement/military-bow-origin";
import { sweepMilitaryArrow } from "../src/shared/settlement/military-projectiles";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { commanderRecruitCost } from "../src/shared/settlement/settlement-commander";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./helpers/hunting-world";

const deployed = () => {
  const world = huntingWorld(), roads = createRoadNetwork(world), cost = commanderRecruitCost("nubian");
  const simulation = createSettlementSimulation({ clockStart: 0, developmentAllowed: true, initialSettlers: 20,
    initialStock: { ...Object.fromEntries(Object.keys(cost).map(ware => [ware, 40])), cloth: 40, planks: 40, stone: 40 },
    playerLevel: () => 23, playerNation: "nubian", roads, world });
  const [w, d] = getBuildingDefinition(62).gridFootprint;
  const placed = simulation.placeBuilding(62, 26 + w / 2, 22 + d / 2);
  if (!placed.ok || !placed.building) throw new Error(placed.reason);
  Object.assign(placed.building, { construction: 1, foundationProgress: 1, required: {} });
  roads.addRoad(simulation.headquarters.access, placed.building.access);
  expect(simulation.recruitCommander(placed.building.uid).ok).toBe(true);
  const saved = simulation.saveState(), soldier = saved.military!.soldiers.find(row => row.commanderId)!;
  const body = saved.actors.find(row => row.uid === soldier.actor)!;
  Object.assign(body, { phase: "militaryField", visible: true, mounted: true, x: 40, z: 40, yaw: 0 });
  soldier.building = -3; saved.military!.commander!.location = "field";
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  const state = () => simulation.militarySoldiers().find(row => row.actor === soldier.actor)!.combat!;
  const start = () => {
    const result = simulation.beginCommanderControl(soldier.actor);
    if (!result.ok) throw new Error(result.reason);
    return result.generation;
  };
  const step = (generation: number, buttons: number = COMMANDER_INPUT_BUTTON.attack, pitch = 1000, heading = 0) => {
    simulation.update(.05);
    expect(simulation.submitCommanderInput({ generation, buttons, pitch, heading, forward: 0, right: 0 })).toBe(true);
  };
  return { simulation, start, state, step, actor: soldier.actor };
};

it("draws and releases one ordinary projectile into empty space with saved pitch and no target", () => {
  const f = deployed(), generation = f.start();
  f.step(generation); f.step(generation);
  expect(f.state().pendingTarget).toBeUndefined();
  expect(f.state().pendingAim).toEqual({ heading: 0, pitch: 1000 });
  expect(f.state().attackTime).toBe(.6);
  for (let tick = 0; tick < 8; tick++) f.step(generation);
  expect(f.simulation.militaryArrows()).toHaveLength(0);
  f.step(generation); f.step(generation);
  const arrow = f.simulation.militaryArrows().find(arrow => arrow.shooter === f.actor)!;
  expect(arrow).toBeDefined(); expect(arrow.vz).toBeGreaterThan(9); expect(arrow.vy).toBeGreaterThan(0);
  expect(f.state().pendingAim).toBeUndefined(); expect(f.state().cooldown).toBeGreaterThan(1);
});

it("early release or control exit cancels the draw without refunding normal cooldown", () => {
  const f = deployed(), generation = f.start();
  f.step(generation); f.step(generation); f.step(generation, 0); f.step(generation, 0);
  expect(f.state().pendingAim).toBeUndefined(); expect(f.state().attackTime).toBe(0);
  expect(f.state().cooldown).toBeGreaterThan(1);
  expect(f.simulation.militaryArrows()).toHaveLength(0);
  f.simulation.endCommanderControl(generation);
  expect(f.state().cooldown).toBeGreaterThan(1);
  const next = f.start();
  for (let tick = 0; tick < 35; tick++) f.step(next);
  expect(f.state().pendingAim).toBeDefined();
  const cooldown = f.state().cooldown;
  f.simulation.endCommanderControl(next);
  expect(f.state().pendingAim).toBeUndefined(); expect(f.state().attackTime).toBe(0);
  expect(f.state().cooldown).toBe(cooldown);
});

it("preserves an in-progress draw across restore and reproduces the complete v2 endpoint", () => {
  const f = deployed(), base = f.simulation.saveState();
  const recorder = createCommandLogRecorder(f.simulation, { sourceVersion: "manual-bow" });
  recorder.open();
  const generation = f.start();
  for (let tick = 0; tick < 7; tick++) f.step(generation);
  const middle = f.simulation.saveState(), restored = deployed();
  expect(restored.simulation.loadState(middle)).toEqual({ ok: true });
  for (let tick = 0; tick < 14; tick++) { f.step(generation); restored.step(generation); }
  expect(restored.simulation.saveState()).toEqual(f.simulation.saveState());
  f.simulation.endCommanderControl(generation);
  const log = recorder.close("home")!, endpoint = f.simulation.saveState(), replay = deployed();
  expect(replay.simulation.loadState(base)).toEqual({ ok: true });
  expect(replayCommandLog(replay.simulation, log)).toMatchObject({ ok: true });
  expect(replay.simulation.saveState()).toEqual(endpoint);
  recorder.dispose();
});

it.each([{ heading: 65536, pitch: 0 }, { heading: 0, pitch: NaN }, { heading: 0, pitch: 16385 }])(
  "rejects forged manual draw angles %j", aim => {
    const f = deployed(), generation = f.start(); f.step(generation); f.step(generation);
    const saved = f.simulation.saveState();
    saved.military!.soldiers.find(row => row.commanderId)!.combat!.pendingAim = aim;
    expect(f.simulation.loadState(saved).ok).toBe(false);
  }
);

it("held fire cannot bypass the normal interval, and an existing enemy does not redirect the shot", () => {
  const f = deployed(), generation = f.start(), releases = new Map<number, number>();
  expect(f.simulation.spawnMilitaryOpponent({ x: 44, z: 44 }, "shield")).not.toBeNull();
  for (let tick = 0; tick < 100; tick++) {
    f.step(generation);
    for (const arrow of f.simulation.militaryArrows()) {
      if (arrow.shooter !== f.actor || releases.has(arrow.id)) continue;
      releases.set(arrow.id, tick);
      expect(Math.abs(arrow.vx)).toBeLessThan(1);
    }
  }
  const ticks = [...releases.values()];
  expect(ticks.length).toBeGreaterThanOrEqual(2);
  for (let index = 1; index < ticks.length; index++) expect(ticks[index]! - ticks[index - 1]!).toBeGreaterThanOrEqual(32);
});

it("sweeps a manual shot against intervening walls and ends its high arc at the bounded flight time", () => {
  const world = huntingWorld(), arrow = { id: 0, shooter: 0, faction: 0, rank: 0,
    x: 40, y: 10, z: 40, vx: 0, vy: 2, vz: 10, age: 0, maximumAge: .25 };
  const blocked = { ...arrow };
  expect(sweepMilitaryArrow(blocked, .2, world, [], [{ uid: 1, x: 40, y: 10, z: 41, width: 1, depth: .3 }]))
    .toEqual({ stopped: true });
  expect(blocked.z).toBeLessThan(41.2);
  expect(sweepMilitaryArrow(arrow, 1, world, [], [])).toEqual({ stopped: true });
  expect(arrow.age).toBe(.25); expect(arrow.z).toBe(42.5);
});

it("manual bow grip and projectile origin share the same pitched hand while preserving actor yaw and horse", () => {
  const f = deployed(), generation = f.start();
  f.step(generation); f.step(generation);
  const actor = f.simulation.frames().find(body => body.uid === f.actor)!;
  const origin = militaryManualBowOrigin(actor, 1000 / 32768 * Math.PI);
  const snapshot = f.simulation.commanderControlSnapshot()!;
  expect(snapshot.aimPoint!.x - origin.x).toBeCloseTo(0, 8);
  expect(Math.hypot(snapshot.aimPoint!.x - origin.x, snapshot.aimPoint!.y - origin.y,
    snapshot.aimPoint!.z - origin.z)).toBeCloseTo(8, 8);
  const saved = f.simulation.saveState();
  expect(f.simulation.loadState(saved)).toEqual({ ok: true });
  expect(f.simulation.commanderControlSnapshot()!.aimPoint).toEqual(snapshot.aimPoint);
});

it("a lethal ordinary blow clears an unfinished draw and preserves a valid commander recovery save", () => {
  const f = deployed(), generation = f.start(); f.step(generation); f.step(generation);
  const enemy = f.simulation.spawnMilitaryOpponent({ x: 40, z: 40.7 }, "shield");
  expect(enemy).not.toBeNull();
  const saved = f.simulation.saveState(), own = saved.military!.soldiers.find(row => row.actor === f.actor)!;
  const opponent = saved.military!.soldiers.find(row => row.actor === enemy)!;
  own.combat!.hp = 1;
  Object.assign(opponent.combat!, { attackTime: .19, cooldown: 1, pendingTarget: f.actor });
  expect(f.simulation.loadState(saved)).toEqual({ ok: true });
  for (let tick = 0; tick < 3; tick++) f.simulation.update(.05);
  expect(f.state().pendingAim).toBeUndefined();
  expect(f.simulation.militaryArrows().filter(arrow => arrow.shooter === f.actor)).toHaveLength(0);
  expect(f.simulation.loadState(f.simulation.saveState())).toEqual({ ok: true });
});

it("calls the same horse after the bow commander actually walks away from its dismount point", () => {
  const f = deployed(), generation = f.start();
  f.step(generation, COMMANDER_INPUT_BUTTON.dismount); f.step(generation, 0);
  expect(f.simulation.commanderControlSnapshot()!.mounted).toBe(false);
  for (let tick = 0; tick < 17; tick++) {
    f.simulation.update(.05);
    expect(f.simulation.submitCommanderInput({ generation, forward: -127, right: 0,
      heading: 0, pitch: 0, buttons: 0 })).toBe(true);
  }
  f.step(generation, 0); f.step(generation, 0);
  const mount = f.state().mount;
  f.step(generation, COMMANDER_INPUT_BUTTON.callHorse);
  for (let tick = 0; tick < 300 && !f.simulation.commanderControlSnapshot()!.mounted; tick++) f.step(generation, 0);
  const state = f.simulation.saveState();
  expect(f.simulation.commanderControlSnapshot()!.mounted, JSON.stringify({ control: state.military!.combat!.directControl,
    actor: state.actors.find(body => body.uid === f.actor), horse: state.actors.find(body => body.uid === mount) })).toBe(true);
  expect(f.state().mount).toBe(mount);
});
