import { describe, expect, it } from "vitest";

import { KNOWLEDGE_MEMORY_SECONDS } from "../src/shared/balance/vision";
import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { replayCommandLog } from "../src/shared/settlement/command-log-replay";
import { militaryHealth } from "../src/shared/settlement/military-combat-rules";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { canonicalJson, hashText } from "../src/shared/settlement/settlement-state-hash";
import { createBalanceSimulation } from "../tools/bench/garrison-balance-harness";

/** targetMilitary (owner 2026-11-17): a right click on an enemy body locks the selection onto that unit. */
const ENEMY = 1;
const TICK = .05;

type Sees = (faction: number, x: number, z: number) => boolean;

const island = () => createBalanceSimulation(48, 3, { x: 6.5, z: 6.5 }, undefined,
  { withoutMilitaryCommander: true });
const run = (simulation: SettlementSimulation, ticks: number) => {
  for (let tick = 0; tick < ticks; tick++) simulation.update(TICK);
};
const combatOf = (simulation: SettlementSimulation, actor: number) =>
  simulation.militarySoldiers().find(entry => entry.actor === actor)?.combat;
const actorOf = (simulation: SettlementSimulation, uid: number) =>
  simulation.frames().find(actor => actor.uid === uid)!;
const hashOf = (simulation: SettlementSimulation) =>
  hashText(canonicalJson({ ...simulation.saveState(), accumulator: 0 }));

/** The player's sight is a switch; the computer always sees (it must never decide the player's chase). */
const sight = (simulation: SettlementSimulation) => {
  const state = { playerSees: true };
  const sees: Sees = faction => faction !== 0 || state.playerSees;
  (simulation.factionVision() as { sees: Sees }).sees = sees;
  return state;
};

/** Three player swordsmen guarding at (16, 24) and one computer swordsman eight tiles away. */
const battle = () => {
  const simulation = island();
  const health = militaryHealth("shield", 0);
  simulation.receiveTroops([0, 1, 2].map(() => ({ hp: health, rank: 0, type: "shield" as const })));
  const players = simulation.militarySoldiers().map(soldier => soldier.actor);
  expect(simulation.commandMilitary(players, { x: 16, z: 24 }, "move")).toBe(true);
  run(simulation, 1200);
  const enemy = simulation.spawnMilitaryOpponent({ x: 24, z: 24 }, "shield", 0, ENEMY)!;
  expect(enemy).not.toBeNull();
  const vision = sight(simulation);
  return { enemy, players, simulation, vision };
};

describe("targetMilitary", () => {
  it("refuses hidden, own, missing targets and selections without own soldiers", () => {
    const { enemy, players, simulation, vision } = battle();
    expect(simulation.targetMilitary(players, players[0]!)).toEqual({ ok: false, reason: "targetNotHostile" });
    expect(simulation.targetMilitary(players, 99_999)).toEqual({ ok: false, reason: "targetMissing" });
    expect(simulation.targetMilitary([enemy], enemy)).toEqual({ ok: false, reason: "noTroops" });
    vision.playerSees = false;
    expect(simulation.targetMilitary(players, enemy)).toEqual({ ok: false, reason: "targetHidden" });
    for (const id of players) expect(combatOf(simulation, id)?.chase).toBeUndefined();
  }, 60_000);

  it("chases a moving target beyond the order point and falls back to attack-move once it dies", () => {
    const { enemy, players, simulation } = battle();
    expect(simulation.targetMilitary(players, enemy)).toEqual({ chasing: 3, ok: true });
    for (const id of players) expect(combatOf(simulation, id)?.chase).toEqual({ uid: enemy });
    // The target flees: the chasers follow it past the place it stood when the order was given.
    expect(simulation.commandMilitaryOpponent([enemy], { x: 34, z: 24 }, ENEMY, "retreat")).toBe(true);
    let furthest = 0, ticks = 0;
    while (combatOf(simulation, enemy) && ticks++ < 2400) {
      simulation.update(TICK);
      furthest = Math.max(furthest, ...players.map(id => actorOf(simulation, id)?.x ?? 0));
    }
    expect(combatOf(simulation, enemy)).toBeUndefined();
    // An attack-move to the target's old place (24) would have stopped there.
    expect(furthest).toBeGreaterThan(27);
    // A swing under way (0.6 s) finishes first.
    run(simulation, 20);
    for (const id of players) {
      const state = combatOf(simulation, id);
      if (!state) continue;
      expect(state.chase).toBeUndefined();
      expect(state.order).toBe("attackMove");
    }
  }, 120_000);

  it("out of sight it heads for where the target vanished; past the memory it gives up there", () => {
    const { enemy, players, simulation, vision } = battle();
    expect(simulation.targetMilitary(players, enemy).ok).toBe(true);
    vision.playerSees = false;
    run(simulation, 2);
    const lost = combatOf(simulation, players[0]!)?.chase?.lost;
    expect(lost).toBeDefined();
    expect(combatOf(simulation, players[0]!)?.destination).toEqual({ x: lost!.x, z: lost!.z });
    // Seen again within the memory: the chase resumes.
    vision.playerSees = true;
    run(simulation, 1);
    expect(combatOf(simulation, players[0]!)?.chase).toEqual({ uid: enemy });
    vision.playerSees = false;
    run(simulation, Math.ceil(KNOWLEDGE_MEMORY_SECONDS / TICK) + 4);
    for (const id of players) {
      const state = combatOf(simulation, id);
      expect(state?.chase).toBeUndefined();
      expect(state?.order).toBe("attackMove");
    }
  }, 120_000);

  it("a target leaving the land (aboard a ship) stops the chase where it was last", () => {
    const { enemy, players, simulation } = battle();
    expect(simulation.targetMilitary(players, enemy).ok).toBe(true);
    run(simulation, 4);
    // The boarding itself is the ship layer's; the chase only reads that the body left for a ship.
    const body = actorOf(simulation, enemy);
    body.navalOrder = 1;
    run(simulation, 1);
    for (const id of players) {
      const state = combatOf(simulation, id)!;
      expect(state.chase).toBeUndefined();
      expect(Math.hypot(state.destination!.x - body.x, state.destination!.z - body.z)).toBeLessThan(2);
    }
  }, 60_000);

  it("a new order ends the lock", () => {
    const { enemy, players, simulation } = battle();
    expect(simulation.targetMilitary(players, enemy).ok).toBe(true);
    expect(simulation.commandMilitary(players, { x: 12, z: 24 }, "move")).toBe(true);
    for (const id of players) expect(combatOf(simulation, id)?.chase).toBeUndefined();
  }, 60_000);

  it("is recorded: the replay and a reload mid-chase reach the same state hash", () => {
    const { enemy, players, simulation } = battle();
    const replica = island();
    expect(replica.loadState(structuredClone(simulation.saveState())).ok).toBe(true);
    sight(replica);
    const recorder = createCommandLogRecorder(simulation, { sourceVersion: "test" });
    recorder.open();
    expect(simulation.targetMilitary(players, enemy).ok).toBe(true);
    run(simulation, 80);
    const interval = recorder.close("home")!;
    expect(interval.entries.map(entry => entry.command.name)).toContain("targetMilitary");
    expect(replayCommandLog(replica, interval)).toEqual({ endChecksum: interval.endChecksum, ok: true });
    expect(hashOf(replica)).toBe(hashOf(simulation));
    const saved = structuredClone(simulation.saveState());
    expect(saved.military?.soldiers.some(soldier => soldier.combat?.chase?.uid === enemy)).toBe(true);
    const reloaded = island();
    expect(reloaded.loadState(saved).ok).toBe(true);
    sight(reloaded);
    run(simulation, 80);
    run(reloaded, 80);
    expect(hashOf(reloaded)).toBe(hashOf(simulation));
  }, 120_000);
});
