import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { KNOWLEDGE_MEMORY_TICKS } from "../src/shared/settlement/faction-knowledge";
import { setVisionProbe, visionProbeReport } from "../src/shared/settlement/faction-vision-probe";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { canonicalJson, hashText } from "../src/shared/settlement/settlement-state-hash";
import { createBalanceSimulation, spawnAround } from "../tools/bench/garrison-balance-harness";
import { advance, ENEMY, villageFixture } from "./helpers/military-assault-fixture";

/**
 * A13 phase 3: the AI acts only on what its faction knows. Knowledge is simulation state: saved, loaded back
 * equal, aged by absolute game ticks (offline jumps included), and the illegal-read probe finds no AI read
 * of an enemy its faction neither sees nor is alerted to.
 */
const CAMP_A = { x: 14, z: 32 };
const CAMP_B = { x: 50, z: 32 };

/** Two computer factions marching on each other's camps (36 tiles apart: they start unseen). */
const battle = () => {
  const simulation = createBalanceSimulation(64, 5, { x: 6.5, z: 6.5 });
  const raise = (camp: { x: number; z: number }, faction: number) =>
    (["shield", "heavy", "archer", "shield", "archer", "heavy"] as const)
      .map(type => spawnAround(simulation, camp, type, 0, faction));
  const first = raise(CAMP_A, 1), second = raise(CAMP_B, 2);
  simulation.commandMilitaryOpponent(first, CAMP_B, 1, "attackMove");
  simulation.commandMilitaryOpponent(second, CAMP_A, 2, "attackMove");
  return simulation;
};

const run = (simulation: SettlementSimulation, ticks: number) => {
  for (let tick = 0; tick < ticks; tick++) simulation.update(.05);
};
const stateHash = (simulation: SettlementSimulation) =>
  hashText(canonicalJson({ ...simulation.saveState(), accumulator: 0 }));
const savedKnowledge = (simulation: SettlementSimulation) => simulation.saveState().military?.combat?.knowledge;

const probeSimulation = (simulation: SettlementSimulation) => setVisionProbe({
  alerted: (faction, uid) => simulation.factionKnowledge().alerted(faction, uid),
  sees: (faction, x, z) => simulation.factionVision().sees(faction, x, z)
});

afterEach(() => { setVisionProbe(null); });

describe("faction knowledge in the simulation", () => {
  it("alerts the victim's faction to the archer that hit it", () => {
    const simulation = createBalanceSimulation(48, 3, { x: 6.5, z: 6.5 }, undefined,
      { withoutMilitaryCommander: true });
    const archer = simulation.spawnMilitaryOpponent({ x: 12, z: 24 }, "archer", 0, 1)!;
    const victim = simulation.spawnMilitaryOpponent({ x: 19, z: 24 }, "shield", 0, 2)!;
    const health = () => simulation.militarySoldiers().find(entry => entry.actor === victim)?.combat?.hp ?? 0;
    const start = health();
    for (let tick = 0; tick < 200 && health() === start; tick++) simulation.update(.05);
    expect(health()).toBeLessThan(start);
    expect(simulation.factionKnowledge().alerted(2, archer)).toBe(true);
    expect(simulation.factionKnowledge().alerted(1, archer)).toBe(false);
  });

  it("saves its memories and alerts, and a loaded battle continues identically", () => {
    const live = battle();
    run(live, 500);
    const saved = structuredClone(live.saveState());
    const knowledge = saved.military?.combat?.knowledge;
    expect((knowledge?.records.length ?? 0) + (knowledge?.alerts.length ?? 0)).toBeGreaterThan(0);
    const restored = battle();
    expect(restored.loadState(saved).ok).toBe(true);
    expect(savedKnowledge(restored)).toEqual(knowledge);
    expect(stateHash(restored)).toBe(stateHash(live));
    run(live, 300);
    run(restored, 300);
    expect(stateHash(restored)).toBe(stateHash(live));
  }, 120_000);

  it("ages knowledge over an offline jump exactly as a jump after a reload does", () => {
    const live = battle();
    run(live, 500);
    const saved = structuredClone(live.saveState());
    const restored = battle();
    expect(restored.loadState(saved).ok).toBe(true);
    live.advanceClock(KNOWLEDGE_MEMORY_TICKS + 1);
    restored.advanceClock(KNOWLEDGE_MEMORY_TICKS + 1);
    expect(savedKnowledge(restored)).toEqual(savedKnowledge(live));
    // Every unit was last known before the jump: memories and alerts are forgotten (A14-4b: the sectors seen
    // stay dated; staleness never expires).
    const aged = savedKnowledge(live);
    expect(aged?.records ?? []).toEqual([]);
    expect(aged?.alerts ?? []).toEqual([]);
    run(live, 100);
    run(restored, 100);
    expect(stateHash(restored)).toBe(stateHash(live));
  }, 120_000);

  it("reads no enemy its faction does not know in a field battle (probe gate)", () => {
    const plain = battle(), probed = battle();
    run(plain, 900);
    probeSimulation(probed);
    run(probed, 900);
    const report = visionProbeReport();
    expect(stateHash(probed)).toBe(stateHash(plain));
    const read = new Set(report.filter(site => site.reads > 0).map(site => site.site));
    for (const site of ["commander.influence", "commander.nearestEnemy", "targeting.acquire", "targeting.keepTarget"])
      expect(read).toContain(site);
    expect(report.filter(site => site.unseen > 0)).toEqual([]);
  }, 120_000);

  it("reads no raider or civilian its faction does not know in a village raid (probe gate)", () => {
    const { sim, site } = villageFixture();
    advance(sim, 15);
    probeSimulation(sim);
    const { access } = sim.headquarters;
    const middle = { x: (access.x + site.access.x) / 2, z: (access.z + site.access.z) / 2 + 1.5 };
    for (const index of [0, 1, 2]) sim.spawnMilitaryOpponent({ x: middle.x + index * .8, z: middle.z }, "heavy", 0,
      ENEMY);
    advance(sim, 30);
    const report = visionProbeReport();
    const read = new Set(report.filter(entry => entry.reads > 0).map(entry => entry.site));
    expect(read).toContain("civilian.hostilePresent");
    expect(report.filter(entry => entry.unseen > 0)).toEqual([]);
  }, 240_000);

  it("reads no renderer, camera, wall clock or randomness", () => {
    const source = readFileSync(resolve(__dirname, "../src/shared/settlement/faction-knowledge.ts"), "utf8");
    expect(source).not.toMatch(/from "[^"]*(renderers|render-common\/workers|app)\//);
    expect(source).not.toMatch(/performance\.now|Date\.now|Math\.random/);
  });
});
