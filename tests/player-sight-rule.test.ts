import { afterEach, describe, expect, it } from "vitest";

import { LEGACY_SIM_RULES, type SimRules } from "../../island-of-settlers-shared/src/game-settings/sim-rules";
import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { replayCommandLog } from "../src/shared/settlement/command-log-replay";
import { setVisionProbe, visionProbeReport } from "../src/shared/settlement/faction-vision-probe";
import { militaryHealth } from "../src/shared/settlement/military-combat-rules";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { canonicalJson, hashText } from "../src/shared/settlement/settlement-state-hash";
import { createBalanceSimulation } from "../tools/bench/garrison-balance-harness";

/**
 * The player troop sight rule (owner 2026-11-13), pinned with the island's game rules: on (absent) the player's
 * soldiers act only on enemies the player knows, exactly as A13 phase 3; off they acquire unseen enemies as before
 * it. Computer soldiers always act on knowledge only (D-AI1).
 */
const SIGHT_OFF: SimRules = { ...LEGACY_SIM_RULES, playerTroopsSightOnly: false, revision: "rev-sight-off" };
const SIGHT_ON: SimRules = { ...LEGACY_SIM_RULES, playerTroopsSightOnly: true, revision: "rev-sight-on" };
const ENEMY = 1;

type Sees = (faction: number, x: number, z: number) => boolean;
const NOBODY_SEES: Sees = () => false;

/** No faction sees anything: only the rule (or a hit alert) can make an enemy known. */
const blind = (simulation: SettlementSimulation) => {
  (simulation.factionVision() as { sees: Sees }).sees = NOBODY_SEES;
};

const island = () => createBalanceSimulation(48, 3, { x: 6.5, z: 6.5 }, undefined,
  { withoutMilitaryCommander: true });

/** One player swordsman guarding in the field and, three tiles away, one computer swordsman. */
const duel = (rules?: SimRules) => {
  const simulation = island();
  if (rules) expect(simulation.adoptGameRules(rules)).toBe(true);
  simulation.receiveTroops([{ hp: militaryHealth("shield", 0), rank: 0, type: "shield" }]);
  const player = simulation.militarySoldiers()[0]!.actor;
  expect(simulation.commandMilitary([player], { x: 20, z: 24 }, "move")).toBe(true);
  for (let tick = 0; tick < 1200; tick++) simulation.update(.05);
  const enemy = simulation.spawnMilitaryOpponent({ x: 23, z: 24 }, "shield", 0, ENEMY)!;
  expect(enemy).not.toBeNull();
  blind(simulation);
  return { enemy, player, simulation };
};

const combatOf = (simulation: SettlementSimulation, actor: number) =>
  simulation.militarySoldiers().find(entry => entry.actor === actor)?.combat;
const run = (simulation: SettlementSimulation, ticks: number) => {
  for (let tick = 0; tick < ticks; tick++) simulation.update(.05);
};
const hashOf = (simulation: SettlementSimulation) =>
  hashText(canonicalJson({ ...simulation.saveState(), accumulator: 0 }));

afterEach(() => { setVisionProbe(null); });

describe("player troop sight rule", () => {
  it("on (absent or pinned): neither side acquires an unseen enemy", () => {
    for (const rules of [undefined, SIGHT_ON]) {
      const { enemy, player, simulation } = duel(rules);
      run(simulation, 60);
      expect(combatOf(simulation, player)?.target).toBeUndefined();
      expect(combatOf(simulation, enemy)?.target).toBeUndefined();
      expect(simulation.effectiveGameRules().playerTroopsSightOnly).toBe(true);
    }
  }, 60_000);

  it("off: the player's soldier acquires the unseen enemy; the computer soldier still does not", () => {
    const { enemy, player, simulation } = duel(SIGHT_OFF);
    const knowledge = simulation.factionKnowledge();
    expect(knowledge.omniscient(0)).toBe(true);
    expect(knowledge.omniscient(ENEMY)).toBe(false);
    simulation.update(.05);
    expect(combatOf(simulation, player)?.target).toBe(enemy);
    const enemyHealth = militaryHealth("shield", 0);
    // Until the first blow lands (the hit alert) the computer soldier knows nothing of its attacker.
    for (let tick = 0; tick < 200 && combatOf(simulation, enemy)?.hp === enemyHealth; tick++) {
      expect(combatOf(simulation, enemy)?.target).toBeUndefined();
      expect(knowledge.troopKnows(ENEMY, { uid: player, x: 0, z: 0 })).toBe(false);
      simulation.update(.05);
    }
    expect(combatOf(simulation, enemy)?.hp).toBeLessThan(enemyHealth);
  }, 60_000);

  it("off: the probe labels the player's unseen reads rule-allowed, never unseen", () => {
    const { simulation } = duel(SIGHT_OFF);
    const knowledge = simulation.factionKnowledge();
    setVisionProbe({ alerted: knowledge.alerted, ruleAllows: knowledge.omniscient, sees: NOBODY_SEES });
    run(simulation, 120);
    const report = visionProbeReport();
    expect(report.find(site => site.site === "targeting.acquire")?.ruleAllowed).toBeGreaterThan(0);
    expect(report.filter(site => site.unseen > 0)).toEqual([]);
  }, 60_000);

  it("off: a recorded adoption replays to the same hash, and a reload keeps the rule", () => {
    const { simulation } = duel();
    const replica = island();
    expect(replica.loadState(structuredClone(simulation.saveState())).ok).toBe(true);
    blind(replica);
    const recorder = createCommandLogRecorder(simulation, { sourceVersion: "test" });
    recorder.open();
    expect(simulation.adoptGameRules(SIGHT_OFF)).toBe(true);
    run(simulation, 200);
    const interval = recorder.close("home")!;
    expect(replayCommandLog(replica, interval)).toEqual({ endChecksum: interval.endChecksum, ok: true });
    expect(hashOf(replica)).toBe(hashOf(simulation));
    expect(replica.gameRules()).toEqual(SIGHT_OFF);
    const reloaded = island();
    expect(reloaded.loadState(structuredClone(simulation.saveState())).ok).toBe(true);
    blind(reloaded);
    expect(reloaded.effectiveGameRules().playerTroopsSightOnly).toBe(false);
    expect(hashOf(reloaded)).toBe(hashOf(simulation));
    run(simulation, 100);
    run(reloaded, 100);
    expect(hashOf(reloaded)).toBe(hashOf(simulation));
  }, 120_000);
});
