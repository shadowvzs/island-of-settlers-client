import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { TICK_SECONDS } from "../../../island-of-settlers-shared/src/time/constants";
import { createHeadlessIsland } from "../../src/app/settlement/headless-replay";
import { setVisionProbe, visionProbeReport } from "../../src/shared/settlement/faction-vision-probe";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import type { MilitaryTroopType } from "../../src/shared/settlement/military-combat-rules";
import type { SettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { canonicalJson, hashText } from "../../src/shared/settlement/settlement-state-hash";
import { FOG } from "../../src/shared/world/world-data";
import { setTickPhaseRecorder, type TickPhaseRecorder } from "../../src/shared/settlement/tick-phase-profile";
import {
  createBalanceSimulation, forceTroops, simulateColonyAssault, spawnAround, typicalForce
} from "./garrison-balance-harness";
import { applyMixedFixture, type TickFixture, tickFixtureSave } from "./settlement-tick-fixtures";

/**
 * A13 bench: the faction vision layer's cost per tick (the "vision" tick phase; since phase 2 it also
 * writes the player's fog: territory, lookout charting and the changed cells), the faction knowledge's
 * memory refresh (the "knowledge" phase, phase 3), the repeat determinism (every repeat and the probed
 * run end on one hash) and the illegal-read probe's call-site list (enemy positions the AI reads that its
 * faction neither sees nor is alerted to; phase 3 gate: 0 everywhere).
 *
 * Scenarios: the developed save as a busy settlement (`owner`, `scaled` +460 carriers), the save
 * with a battle beside the economy (`mixed`), and a flat 64 vs 64 battle (military-battle-tick).
 * Usage: npx tsx tools/bench/faction-vision-cost.ts <save.json> [seconds=60] [repeats=2]
 */
const [file, secondsArgument, repeatsArgument] = process.argv.slice(2);
if (!file) throw new Error("Usage: faction-vision-cost.ts <save.json> [seconds] [repeats]");
const seconds = Number(secondsArgument ?? 60);
const repeats = Number(repeatsArgument ?? 2);
const save = JSON.parse(readFileSync(file, "utf8")) as GameSaveV1;
const BATTLE_SIDE = 64, BATTLE_MAP = 96;
const BATTLE_TYPES: readonly MilitaryTroopType[] = ["shield", "heavy", "archer", "cavalry"];

interface Scenario { label: string; create: () => Promise<SettlementSimulation> }

const island = (fixture: TickFixture) => async () => {
  const created = await createHeadlessIsland(tickFixtureSave(save, fixture));
  for (const _progress of created.simulation.prewarmCoastalGeometry()) { /* Derived caches only. */ }
  if (fixture === "mixed") applyMixedFixture(created.simulation);
  return created.simulation;
};

/** The military-battle-tick flat battle: 64 player soldiers against 64 computer soldiers. */
const flatBattle = async () => {
  // A hidden fog layer (the balance world has none) so the battle pays the player's fog writes too.
  const simulation = createBalanceSimulation(BATTLE_MAP, 7, { x: 10.5, z: 48.5 },
    world => { world.fog = new Uint8Array(BATTLE_MAP * BATTLE_MAP).fill(FOG.hidden); });
  simulation.receiveTroops(forceTroops(typicalForce(BATTLE_SIDE, { archers: true, cavalry: true })));
  simulation.callOutMilitary([...BATTLE_TYPES], { x: 30, z: 48 });
  for (let second = 0; second < 120; second++) simulation.update(1);
  const enemies = forceTroops(typicalForce(BATTLE_SIDE, { archers: true, cavalry: true })).map((troop, index) =>
    spawnAround(simulation, { x: 58 + (index % 8) * 1.2, z: 44 + Math.floor(index / 8) * 1.2 }, troop.type));
  simulation.commandMilitaryOpponent(enemies, { x: 30, z: 48 }, 1, "attackMove");
  const inField = new Set(simulation.frames().filter(actor => actor.phase === "militaryField").map(actor => actor.uid));
  const own = simulation.militarySoldiers().filter(soldier => (soldier.combat?.faction ?? 0) === 0 &&
    inField.has(soldier.actor)).map(soldier => soldier.actor);
  simulation.commandMilitary(own, { x: 62, z: 48 }, "attackMove");
  return simulation;
};

/**
 * Probe only: a whole hard colony island (forts, camp guards, the computer commander) assaulted by a
 * typical 40-soldier force, through the balance harness's own assault loop.
 */
const probeColonyAssault = () => {
  setVisionProbe("latest");
  let report: ReturnType<typeof visionProbeReport> = [];
  try {
    const outcome = simulateColonyAssault({ difficulty: "hard", seed: 3, limit: seconds * 5,
      force: typicalForce(40, { archers: true }) });
    report = visionProbeReport();
    return { outcome, report };
  } finally { setVisionProbe(null); }
};

const SCENARIOS: readonly Scenario[] = [
  { create: island("owner"), label: "busy settlement (developed save)" },
  { create: island("scaled"), label: "busy settlement +460 carriers" },
  { create: island("mixed"), label: "battle beside the economy" },
  { create: flatBattle, label: "flat battle 64 vs 64" }
];

const MEASURED_PHASES = ["vision", "knowledge"] as const;
type MeasuredPhase = typeof MEASURED_PHASES[number];

/** Per-tick wall ms of the `vision` and `knowledge` phases (the last two: they close at the tick's end). */
const phaseSpans = () => {
  const spans: Record<MeasuredPhase, number[]> = { knowledge: [], vision: [] };
  let open: MeasuredPhase | null = null, openedAt = 0;
  const close = () => { if (open !== null) spans[open].push(performance.now() - openedAt); open = null; };
  const recorder: TickPhaseRecorder = {
    endTick: close,
    mark: phase => {
      close();
      if (!(MEASURED_PHASES as readonly string[]).includes(phase)) return;
      open = phase as MeasuredPhase; openedAt = performance.now();
    }
  };
  return { recorder, spans };
};

const percentile = (sorted: readonly number[], share: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;
const describe = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length);
  return { max: +(sorted.at(-1) ?? 0).toFixed(4), mean: +mean.toFixed(4), median: +percentile(sorted, .5).toFixed(4),
    p95: +percentile(sorted, .95).toFixed(4), p99: +percentile(sorted, .99).toFixed(4) };
};

const ticks = () => Math.round(seconds / TICK_SECONDS);
const hashOf = (simulation: SettlementSimulation) => hashText(canonicalJson(simulation.saveState()));

const runTimed = async (scenario: Scenario) => {
  const simulation = await scenario.create(), timing = phaseSpans(), tickMs: number[] = [];
  setTickPhaseRecorder(timing.recorder);
  try {
    for (let tick = 0; tick < ticks(); tick++) {
      const started = performance.now();
      simulation.update(TICK_SECONDS);
      tickMs.push(performance.now() - started);
    }
  } finally { setTickPhaseRecorder(null); }
  const stats = { ...simulation.factionVision().stats(), ...simulation.factionKnowledge().stats() };
  return { hash: hashOf(simulation), knowledge: describe(timing.spans.knowledge), stats, tick: describe(tickMs),
    vision: describe(timing.spans.vision) };
};

const runProbed = async (scenario: Scenario) => {
  const simulation = await scenario.create();
  setVisionProbe({ alerted: (faction, uid) => simulation.factionKnowledge().alerted(faction, uid),
    sees: (faction, x, z) => simulation.factionVision().sees(faction, x, z) });
  let report: ReturnType<typeof visionProbeReport> = [];
  try {
    for (let tick = 0; tick < ticks(); tick++) simulation.update(TICK_SECONDS);
    report = visionProbeReport();
  } finally { setVisionProbe(null); }
  // The probe must observe only: the run ends on the plain run's hash.
  return { hash: hashOf(simulation), report };
};

for (const scenario of SCENARIOS) {
  const timed = [];
  for (let repeat = 0; repeat < repeats; repeat++) timed.push(await runTimed(scenario));
  const probed = await runProbed(scenario);
  console.log(JSON.stringify({
    scenario: scenario.label, simulatedSeconds: seconds,
    hashIdentical: timed.every(run => run.hash === probed.hash),
    observers: timed[0]!.stats,
    visionMsPerTick: timed.map(run => run.vision), knowledgeMsPerTick: timed.map(run => run.knowledge),
    tickMs: timed.map(run => run.tick),
    illegalReads: probed.report
  }, null, 2));
}
console.log(JSON.stringify({ scenario: "colony assault (hard, probe only)", ...probeColonyAssault() }, null, 2));
