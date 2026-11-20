import { performance } from "node:perf_hooks";

import { setFactionAiProbe } from "../../src/shared/settlement/economy-ai/faction-ai-probe";
import { setVisionProbe, visionProbeReport } from "../../src/shared/settlement/faction-vision-probe";
import { canonicalJson, hashText } from "../../src/shared/settlement/settlement-state-hash";
import { setTickPhaseRecorder } from "../../src/shared/settlement/tick-phase-profile";
import {
  createMilitarySimulation, MILITARY_AI, MILITARY_DEPOT, MILITARY_KIT, militaryIslandWorld
} from "../../tests/helpers/military-island";
import { emitBenchJson } from "./bench-json";

/**
 * EAI4a perf gate (enemy economy AI plan §6, §7 P4): one `develop` faction at its caps, 80 soldiers and 150
 * civilians, on the P4 military island. The faction first plays `warmup` game minutes (it builds its town and
 * garrisons), then `ticks` fixed ticks are timed: the whole tick (median, p95) and the `economyAi` phase (average,
 * p95 of decision ticks, worst), the A13 probe's unseen reads, and the faction's soldiers and civilians at the end.
 * Lane-only (the base has no military economy); the TOOL-4 A/B regression check is `faction-ai-cost.ts develop`.
 * Usage: npx tsx tools/bench/faction-ai-army-cost.ts [ticks=6000] [repeats=3] [warmup=30]
 */
const [ticksArgument, repeatsArgument, warmupArgument] = process.argv.slice(2);
const ticks = Number(ticksArgument ?? 6000);
const repeats = Number(repeatsArgument ?? 3);
const warmupTicks = Number(warmupArgument ?? 30) * 60 * 20;
const TICK = 0.05;
const AI_PHASE = "economyAi";
const PERCENTILE_95 = 0.95;
/** The caps of plan §6.3: civilians (start settlers) and soldiers (start reserve, by troop type). */
const ARMY_KIT = {
  ...MILITARY_KIT, settlers: 150,
  soldiers: [{ count: 40, rank: 0, type: "shield" as const }, { count: 20, rank: 0, type: "archer" as const },
    { count: 20, rank: 0, type: "heavy" as const }]
};

const percentile = (values: readonly number[], fraction: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]!;
};

const current = { aiMs: 0 };
const recordAiPhase = () => {
  let openedAt = 0, open = false;
  const close = () => {
    if (open) current.aiMs += performance.now() - openedAt;
    open = false;
  };
  setTickPhaseRecorder({ endTick: close, mark: phase => {
    close();
    if (phase !== AI_PHASE) return;
    open = true;
    openedAt = performance.now();
  } });
};

const createArmyIsland = () => {
  const simulation = createMilitarySimulation(militaryIslandWorld());
  const placed = simulation.aiPlace(MILITARY_AI, MILITARY_DEPOT, ARMY_KIT);
  if (!placed.ok) throw new Error(`Army island depot: ${placed.reason}`);
  return simulation;
};

const peopleOf = (simulation: ReturnType<typeof createArmyIsland>) => {
  const save = simulation.saveState();
  const soldiers = save.military?.soldiers.filter(soldier => soldier.combat?.faction === MILITARY_AI).length ?? 0;
  const onDuty = save.actors.filter(actor => actor.hostileCivilianFaction === MILITARY_AI &&
    actor.phase !== "retired").length;
  const idle = save.buildings.filter(building => building.militaryFaction === MILITARY_AI)
    .reduce((sum, building) => sum + (building.idleSettlers ?? 0), 0);
  return { civilians: onDuty + idle, soldiers };
};

const measure = () => {
  const simulation = createArmyIsland();
  while (simulation.gameTick() < warmupTicks) simulation.update(TICK);
  recordAiPhase();
  setVisionProbe("latest");
  const tickMs: number[] = [], aiMs: number[] = [], decisionAiMs: number[] = [];
  let decided = false;
  setFactionAiProbe({ decide: () => { decided = true; } });
  for (let step = 0; step < ticks; step++) {
    decided = false;
    current.aiMs = 0;
    const started = performance.now();
    simulation.update(TICK);
    tickMs.push(performance.now() - started);
    aiMs.push(current.aiMs);
    if (decided) decisionAiMs.push(current.aiMs);
  }
  setFactionAiProbe(null);
  setTickPhaseRecorder(null);
  const unseen = visionProbeReport().reduce((sum, site) => sum + site.unseen, 0);
  setVisionProbe(null);
  return {
    ...peopleOf(simulation), aiAvg: aiMs.reduce((sum, value) => sum + value, 0) / aiMs.length,
    aiDecisionP95: percentile(decisionAiMs, PERCENTILE_95), aiMax: Math.max(...aiMs),
    stateHash: hashText(canonicalJson(simulation.saveState())), tickMedian: percentile(tickMs, .5),
    tickP95: percentile(tickMs, PERCENTILE_95), unseen
  };
};

const runs = Array.from({ length: repeats }, measure);
const best = runs.reduce((low, run) => run.tickMedian < low.tickMedian ? run : low);
const format = (value: number) => value.toFixed(4);
console.log("| ticks | soldiers | civilians | tick median ms | tick p95 ms | economyAi avg ms | decision p95 ms |" +
  " worst ms | unseen | hash |");
console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
console.log(`| ${ticks} | ${best.soldiers} | ${best.civilians} | ${format(best.tickMedian)} | ` +
  `${format(best.tickP95)} | ${format(best.aiAvg)} | ${format(best.aiDecisionP95)} | ${format(best.aiMax)} | ` +
  `${best.unseen} | ${best.stateHash}${new Set(runs.map(run => run.stateHash)).size > 1 ? " (repeats differ)" : ""} |`);
emitBenchJson({ army: best });
