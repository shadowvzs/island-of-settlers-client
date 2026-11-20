import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { emitBenchJson } from "./bench-json";
import { createFactionAiFixture, type FactionAiFixtureModules } from "./faction-ai-fixture";

/**
 * EAI2a bench (enemy economy AI plan §6.2 decision budget, §7 P2 gate): the 4-faction `maintain` fixture
 * (`faction-ai-fixture.ts`) for `ticks` fixed ticks. Reports the whole tick (median, p95) and the `economyAi` tick
 * phase: the average over every tick, the p95 over decision ticks (a layer decided) and the worst single tick, plus
 * the A13 probe's unseen reads and the end state hash. The simulation modules are loaded from the working
 * directory, so the TOOL-4 runner measures its base checkout (where the map's `factionAi` is not read yet) with the
 * same fixture: npx tsx tools/bench/ab-runner.ts --base master ... -- <lane>/tools/bench/faction-ai-cost.ts
 * `mode` `develop` (EAI3a) measures the strategic goal scoring on the same map with a stocked depot per faction.
 * Usage: npx tsx tools/bench/faction-ai-cost.ts [ticks=6000] [repeats=3] [mode=maintain|develop]
 */
const [ticksArgument, repeatsArgument, modeArgument] = process.argv.slice(2);
const mode = modeArgument === "develop" ? "develop" : "maintain";
const ticks = Number(ticksArgument ?? 6000);
const repeats = Number(repeatsArgument ?? 3);
const TICK = 0.05;
const AI_PHASE = "economyAi";
const PERCENTILE_95 = 0.95;

const load = <Module>(path: string): Promise<Module> =>
  import(pathToFileURL(resolve(path)).href) as Promise<Module>;
type Simulation = typeof import("../../src/shared/settlement/settlement-simulation");
type Roads = typeof import("../../src/shared/settlement/road-network");
type Scenario = typeof import("../../src/shared/world/map-scenario");
type Phases = typeof import("../../src/shared/settlement/tick-phase-profile");
type Hash = typeof import("../../src/shared/settlement/settlement-state-hash");
type Probe = typeof import("../../src/shared/settlement/faction-vision-probe");
type AiProbe = typeof import("../../src/shared/settlement/economy-ai/faction-ai-probe");

const AI_PROBE_FILE = "src/shared/settlement/economy-ai/faction-ai-probe.ts";
const [simulationModule, roads, scenario, phases, hash, probe] = await Promise.all([
  load<Simulation>("src/shared/settlement/settlement-simulation.ts"),
  load<Roads>("src/shared/settlement/road-network.ts"),
  load<Scenario>("src/shared/world/map-scenario.ts"),
  load<Phases>("src/shared/settlement/tick-phase-profile.ts"),
  load<Hash>("src/shared/settlement/settlement-state-hash.ts"),
  load<Probe>("src/shared/settlement/faction-vision-probe.ts")
]);
/** Absent on a base checkout before EAI2a: decision ticks are then unknown (no AI decides there). */
const aiProbe = existsSync(resolve(AI_PROBE_FILE)) ? await load<AiProbe>(AI_PROBE_FILE) : undefined;
const modules: FactionAiFixtureModules = { createMapScenario: scenario.createMapScenario,
  createRoadNetwork: roads.createRoadNetwork, createSettlementSimulation: simulationModule.createSettlementSimulation };

const percentile = (values: readonly number[], fraction: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]!;
};

/** The `economyAi` span of the running tick (ms), written by the phase recorder. */
const current = { aiMs: 0 };
const setTickPhaseRecorderFor = () => {
  let openedAt = 0, open = false;
  const close = () => {
    if (open) current.aiMs += performance.now() - openedAt;
    open = false;
  };
  phases.setTickPhaseRecorder({
    endTick: close,
    mark: phase => {
      close();
      if (phase !== AI_PHASE) return;
      open = true;
      openedAt = performance.now();
    }
  });
};

/** Times each tick and its `economyAi` phase; `decided` marks the ticks on which a layer decided. */
const measure = () => {
  setTickPhaseRecorderFor();
  probe.setVisionProbe("latest");
  const { simulation } = createFactionAiFixture(modules, mode);
  const tickMs: number[] = [], aiMs: number[] = [], decisionAiMs: number[] = [];
  let decisions = 0, decided = false;
  aiProbe?.setFactionAiProbe({ decide: () => { decisions++; decided = true; } });
  for (let step = 0; step < ticks; step++) {
    decided = false;
    current.aiMs = 0;
    const started = performance.now();
    simulation.update(TICK);
    tickMs.push(performance.now() - started);
    aiMs.push(current.aiMs);
    if (decided) decisionAiMs.push(current.aiMs);
  }
  aiProbe?.setFactionAiProbe(null);
  phases.setTickPhaseRecorder(null);
  const unseen = probe.visionProbeReport().reduce((sum, site) => sum + site.unseen, 0);
  const aiReads = probe.visionProbeReport().filter(site => site.site.startsWith("economyAi."))
    .reduce((sum, site) => sum + site.reads, 0);
  probe.setVisionProbe(null);
  // The fixture world has no fog or ore layer: the settlement save is the whole changing state.
  const stateHash = hash.hashText(hash.canonicalJson(simulation.saveState()));
  return {
    aiAvg: aiMs.reduce((sum, value) => sum + value, 0) / aiMs.length,
    aiDecisionP95: percentile(decisionAiMs, PERCENTILE_95),
    aiMax: Math.max(...aiMs), aiReads, decisions, stateHash, tickMedian: percentile(tickMs, .5),
    tickP95: percentile(tickMs, PERCENTILE_95), unseen
  };
};

const runs = Array.from({ length: repeats }, measure);
const best = runs.reduce((low, run) => run.tickMedian < low.tickMedian ? run : low);
const hashes = new Set(runs.map(run => run.stateHash));
const format = (value: number) => value.toFixed(4);
console.log("| ticks | tick median ms | tick p95 ms | economyAi avg ms | decision p95 ms | worst ms | decisions |"
  + " economyAi reads | unseen | hash |");
console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
console.log(`| ${ticks} | ${format(best.tickMedian)} | ${format(best.tickP95)} | ${format(best.aiAvg)} | `
  + `${format(best.aiDecisionP95)} | ${format(best.aiMax)} | ${best.decisions} | ${best.aiReads} | ${best.unseen} | `
  + `${best.stateHash}${hashes.size > 1 ? " (repeats differ)" : ""} |`);
emitBenchJson({ [mode]: { ...best, repeatsIdentical: hashes.size === 1 } });
