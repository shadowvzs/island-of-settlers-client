import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

import { COMMANDER_INPUT_BUTTON } from "../../island-of-settlers-shared/src/commander-input";
import { DEFAULT_ISLAND_CHOICE, readIslandChoice, toWorldOptions } from "../src/app/map-generator/helpers";
import { DMath } from "../src/shared/math/deterministic-math";
import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { replayCommandLog } from "../src/shared/settlement/command-log-replay";
import { militaryGroundPath } from "../src/shared/settlement/military-routing";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { savedOccupancy } from "../src/shared/settlement/save-cell-codecs";
import type { SettlementSaveV1 } from "../src/shared/settlement/settlement-save-state";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { cachedWorld, cachedWorldBeforeAll } from "./helpers/cached-worlds";
import { editSavedOccupancy } from "./helpers/saved-occupancy";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/commander-coast-horse-call.json", import.meta.url), "utf8")) as {
  query: string; state: SettlementSaveV1;
};
/** The fixture was recorded on a terrain-seed-v6 default island: Massif relief, classic peaks. */
const choice = readIslandChoice(new URLSearchParams(`${fixture.query}&fluvialErosion=0&peakUplift=0`),
  DEFAULT_ISLAND_CHOICE);
const options = { ...DEFAULT_WORLD_OPTIONS, ...toWorldOptions(choice), seed: fixture.state.world.seed };
const getWorld = cachedWorldBeforeAll(options);

it("uses the reachable existing side for the actual coast horse call and retains that route through replanning", () => {
  const saved = fixture.state, world = getWorld(), roads = createRoadNetwork(world);
  const soldier = saved.military!.soldiers.find(row => row.commanderId)!;
  const actor = saved.actors.find(body => body.uid === soldier.actor)!;
  const horse = saved.actors.find(body => body.uid === soldier.combat!.mount)!;
  // The v7 coast moved: pin the recorded v6 condition by closing the first beside cell.
  const blockedSide = { x: actor.x + DMath.cos(actor.yaw) * .7,
    z: actor.z - DMath.sin(actor.yaw) * .7 };
  editSavedOccupancy(saved, grid => {
    const cell = Math.floor(blockedSide.z) * world.cellsX + Math.floor(blockedSide.x);
    if (cell >= 0 && cell < grid.length) grid[cell] = 1;
  });
  const simulation = createSettlementSimulation({ clockStart: 0, developmentAllowed: true,
    playerLevel: () => 23, playerNation: "nubian", roads, world });
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  const context = { actors: saved.actors, buildings: saved.buildings, navigationRevision: 0,
    occupied: savedOccupancy(saved), options: { roads, world }, playerNation: saved.playerNation,
    reservations: new Set(saved.reservations) } as unknown as SettlementContext;
  const side = (sign: number) => ({ x: actor.x + DMath.cos(actor.yaw) * .7 * sign,
    z: actor.z - DMath.sin(actor.yaw) * .7 * sign });
  expect(militaryGroundPath(context, horse, side(1), true)).toBeNull();
  expect(militaryGroundPath(context, horse, side(-1), true)).not.toBeNull();
  const recorder = createCommandLogRecorder(simulation, { sourceVersion: "coast-horse-call" });
  recorder.open();
  const lease = saved.military!.combat!.directControl!.lease!;
  let previous = { x: horse.x, z: horse.z }, maximumStep = 0;
  for (let tick = 0; tick < 160 && !simulation.commanderControlSnapshot()!.mounted; tick++) {
    simulation.update(.05);
    expect(simulation.submitCommanderInput({ generation: lease.generation, heading: lease.input.heading,
      forward: 0, right: 0, pitch: 0, buttons: tick === 0 ? COMMANDER_INPUT_BUTTON.callHorse : 0 })).toBe(true);
    const actual = simulation.frames().find(body => body.uid === horse.uid)!;
    maximumStep = Math.max(maximumStep, Math.hypot(actual.x - previous.x, actual.z - previous.z));
    previous = actual;
  }
  const after = simulation.saveState(), actual = simulation.commanderControlSnapshot()!;
  expect(actual.mounted).toBe(true); expect(actual.actor).toBe(actor.uid); expect(actual.hp).toBe(soldier.combat!.hp);
  expect(maximumStep).toBeLessThan(.12);
  expect(after.military!.combat!.directControl!.horse).toBeUndefined();
  expect(after.actors.filter(body => body.uid === horse.uid)).toHaveLength(1);
  expect(after.actors.find(body => body.uid === horse.uid)!.visible).toBe(false);
  expect(after.military!.soldiers.find(row => row.commanderId)!.combat!.mount).toBe(horse.uid);
  const log = recorder.close("home")!, replayWorld = cachedWorld(options);
  const replay = createSettlementSimulation({ clockStart: 0, developmentAllowed: true, playerLevel: () => 23,
    playerNation: "nubian", roads: createRoadNetwork(replayWorld), world: replayWorld });
  expect(replay.loadState(saved)).toEqual({ ok: true });
  expect(replayCommandLog(replay, log)).toMatchObject({ ok: true });
  expect(replay.saveState()).toEqual(after);
  expect(simulation.loadState(after)).toEqual({ ok: true });
  recorder.dispose();
});
