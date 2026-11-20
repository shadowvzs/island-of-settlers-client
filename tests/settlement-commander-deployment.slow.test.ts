import { describe, expect, it, vi } from "vitest";

import { colonyIslandOffers } from "../src/shared/settlement/colony-expedition-rules";
import { colonyExpiryAssets } from "../src/shared/settlement/colony-expiry-assets";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { commanderMaximumHealth } from "../src/shared/settlement/settlement-commander";
import type { CommanderManifest } from "../src/shared/settlement/settlement-commander-transport";
import { colony, troops } from "./helpers/colony-simulation";
import { fakeColonyConquest } from "./helpers/fake-colony-conquest";

vi.mock("../src/shared/world/generation/generate-world", async (importOriginal) =>
  (await import("./helpers/world-cache-store")).cachedGenerateWorldModule(importOriginal));

const islands = colonyIslandOffers(1234);
const manifest = (overrides: Partial<CommanderManifest> = {}): CommanderManifest => ({
  casualty: false,
  destinationName: "Test Colony",
  healingSeconds: 0,
  homeIslandSeed: 4,
  hp: commanderMaximumHealth(1) * .8,
  id: "commander-test-1",
  level: 1,
  maximumHp: commanderMaximumHealth(1),
  name: "Aurelius",
  nation: "roman",
  operationId: 7,
  phase: "outward",
  recoverySeconds: 0,
  xp: 0,
  ...overrides
});

const landed = () => {
  const island = islands.find(entry => entry.difficulty === "easy")!;
  const { simulation } = colony(island);
  const commander = manifest();
  expect(simulation.startColony({ island, landed: {},
    troops: [...troops(4), { commander, hp: commander.hp, rank: 0, type: "cavalry" }] })).toEqual({ ok: true });
  return { commander, simulation };
};

describe("commander deployment and return", () => {
  it("adopts one manifest on the destination and lands it through the harbour", () => {
    const { commander, simulation } = landed();
    expect(simulation.commanderTransport()).toMatchObject({
      id: commander.id, level: 1, location: "travelling", operationId: 7
    });
    expect(simulation.militarySoldiers().filter(soldier => soldier.commanderId === commander.id)).toHaveLength(1);
    const saved = simulation.saveState();
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    for (let tick = 0; tick < 400; tick++) simulation.update(.05);
    expect(simulation.commanderTransport()).toMatchObject({ location: "field" });
    expect(simulation.commanderSnapshot()).toMatchObject({ deckSlots: 2, hp: commander.hp });
  }, 30000);

  it("keeps an incapacitated commander as an awaiting/returning casualty, not an ordinary death", () => {
    const { commander, simulation } = landed();
    for (let tick = 0; tick < 400; tick++) simulation.update(.05);
    const saved = simulation.saveState();
    saved.military!.soldiers = saved.military!.soldiers.map(soldier => soldier.commanderId === commander.id
      ? { ...soldier, combat: { ...soldier.combat!, hp: 0 } } : soldier);
    saved.military!.commander = { ...saved.military!.commander!, location: "awaiting-evacuation",
      awayHp: 0, transport: { destinationName: "Test Colony", operationId: 7, phase: "awaiting-evacuation" } };
    saved.actors = saved.actors.map(actor => actor.uid === saved.military!.soldiers.find(soldier =>
      soldier.commanderId === commander.id)!.actor
      // The landed cavalry commander now rides in the field; incapacitation dismounts him exactly
      // as `settlement-commander-state.ts` does (mounted is only valid in mounted phases).
      ? { ...actor, mounted: false, phase: "commanderIncapacitated", visible: false } : actor);
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    simulation.update(.1);
    expect(simulation.militarySoldiers().some(soldier => soldier.commanderId === commander.id)).toBe(true);
    expect(simulation.commanderTransport()).toMatchObject({ id: commander.id });
    expect(["awaiting-evacuation", "returning"]).toContain(simulation.commanderTransport()!.location);
    expect(simulation.commanderTransport()!.blockReason).not.toBeNull();
    for (let tick = 0; tick < 6000 && simulation.commanderTransport(); tick++) simulation.update(.05);
    expect(simulation.commanderTransport()).toBeUndefined();
  }, 30000);

  it("returns a living low-HP commander through a real request instead of dying", () => {
    const { commander, simulation } = landed();
    for (let tick = 0; tick < 400; tick++) simulation.update(.05);
    const saved = simulation.saveState();
    saved.military!.soldiers = saved.military!.soldiers.map(soldier => soldier.commanderId === commander.id
      ? { ...soldier, combat: { ...soldier.combat!, hp: commander.maximumHp * .55 } } : soldier);
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    // A living commander may always be physically returned; the 50% gate only blocks new outward deployments.
    expect(simulation.commanderTransport()).toMatchObject({ canReturn: true });
    // A deployed living commander may return even below the 50% deployment gate.
    saved.military!.soldiers = saved.military!.soldiers.map(soldier => soldier.commanderId === commander.id
      ? { ...soldier, combat: { ...soldier.combat!, hp: commander.maximumHp * .2 } } : soldier);
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    expect(simulation.commanderTransport()).toMatchObject({ canReturn: true });
    expect(simulation.returnCommander()).toMatchObject({ ok: true });
    expect(simulation.commanderTransport()).toMatchObject({ location: "returning" });
    expect(simulation.militarySoldiers().some(soldier => soldier.commanderId === commander.id)).toBe(true);
  }, 30000);

  it("hands a filed colony's commander to the survivor receipt on expiry", () => {
    const { commander, simulation } = landed();
    for (let tick = 0; tick < 400; tick++) simulation.update(.05);
    const save = simulation.saveState();
    const assets = colonyExpiryAssets({ settlement: save } as GameSaveV1);
    const receipt = assets.troops.find(troop => troop.commander)!;
    expect(receipt.commander).toMatchObject({ id: commander.id, operationId: 7, phase: "returning" });
    expect(receipt.hp).toBeGreaterThan(0);
  }, 30000);

  it("awards one XP at the conquest boundary and refuses to let a lone commander hold the colony", () => {
    const { simulation } = landed();
    for (let tick = 0; tick < 400; tick++) simulation.update(.05);
    expect(simulation.commanderTransport()).toMatchObject({ location: "field" });
    fakeColonyConquest(simulation);
    expect(simulation.commanderSnapshot()).toMatchObject({ xp: 1, level: 1 });
    for (let tick = 0; tick < 20; tick++) simulation.update(.05);
    expect(simulation.commanderSnapshot()!.xp).toBe(1);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    expect(simulation.commanderSnapshot()!.xp).toBe(1);

    const lone = landed();
    for (let tick = 0; tick < 400; tick++) lone.simulation.update(.05);
    const saved = lone.simulation.saveState();
    const removed = new Set(saved.military!.soldiers.filter(soldier =>
      (soldier.combat?.faction ?? 0) === 0 && soldier.commanderId !== lone.commander.id)
      .flatMap(soldier => [soldier.actor, soldier.combat?.mount]));
    saved.military!.soldiers = saved.military!.soldiers.filter(soldier => !removed.has(soldier.actor));
    saved.actors = saved.actors.filter(actor => !removed.has(actor.uid));
    expect(lone.simulation.loadState(saved)).toEqual({ ok: true });
    for (let tick = 0; tick < 20; tick++) lone.simulation.update(.05);
    expect(lone.simulation.colony()!.status).toBe("defeated");
    expect(lone.simulation.commanderState()!.failureId).toBeTruthy();
  }, 30000);
});
