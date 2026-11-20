import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { movementOutcome } from "../../src/shared/settlement/settlement-navigation-recovery";
import type { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import {
  resetTrafficWork, snapshotTrafficWork
} from "../../src/shared/settlement/settlement-traffic-counters";
import type { SettlementBuilding } from "../../src/shared/settlement/settlement-types";
import { resourcesPath } from "./resources-path";
import { createCrowdScenario } from "./settlement-crowd-scenario";

/**
 * Crowd CPU receipt (council exp4): two construction sites needing 40 planks and 40 stone each,
 * at 100, 300 and 1000 settlers. Reports tick percentiles, the deterministic work counters that
 * CI gates on, materials still owed (throughput) and stuck actor-seconds; wall time is a receipt only.
 * Usage: npx tsx tools/bench/settlement-crowd-cpu-review.ts [minutes] [receipt label]
 */
const STUCK_SECONDS = 6;
const minutes = Number(process.argv[2] ?? 3);
const label = process.argv[3] ?? new Date().toISOString().slice(0, 10);

/** Materials still owed to the sites: lower means more deliveries in the same time. */
const owedMaterials = (sites: readonly SettlementBuilding[]) =>
  sites.reduce((sum, site) => sum + (site.required.planks ?? 0) + (site.required.stone ?? 0), 0);
/** Visible units whose route has made no progress for six seconds (recovery territory). */
const stuckActors = (simulation: ReturnType<typeof createSettlementSimulation>) =>
  simulation.navigationDiagnostics().actors.filter(actor => actor.elapsed >= STUCK_SECONDS).length;

const percentile = (sorted: number[], fraction: number) => sorted[Math.floor(sorted.length * fraction)] ?? 0;

const measure = (settlers: number) => {
  const { simulation, sites } = createCrowdScenario(settlers);
  const times: number[] = [];
  let movingSeconds = 0, stuckActorSeconds = 0;
  resetTrafficWork();
  const cpuStart = process.cpuUsage();
  for (let tick = 0; tick < minutes * 1200; tick++) {
    const start = performance.now();
    simulation.update(0.05);
    times.push(performance.now() - start);
    for (const actor of simulation.frames())
      if (actor.visible && movementOutcome(actor) === "moving") movingSeconds += 0.05;
    if (tick % 20 === 0) stuckActorSeconds += stuckActors(simulation);
  }
  const cpu = process.cpuUsage(cpuStart);
  const work = snapshotTrafficWork();
  times.sort((a, b) => a - b);
  return {
    /** Process CPU time per tick: robust on a shared, loaded machine where wall percentiles are not. */
    cpuMsPerTick: (cpu.user + cpu.system) / 1000 / times.length,
    maxMs: times.at(-1), meanMs: times.reduce((sum, time) => sum + time, 0) / times.length, movingActorSeconds: +movingSeconds.toFixed(1), owedMaterials: owedMaterials(sites),
    p95Ms: percentile(times, .95), p99Ms: percentile(times, .99),
    proactiveShouldersPerMovingSecond: +(work.proactiveShoulders / Math.max(1, movingSeconds)).toFixed(3),
    samplesPerSegmentCall: +(work.segmentSamples / Math.max(1, work.segmentCalls)).toFixed(1),
    settlers, stuckActorSeconds, ticks: times.length, work
  };
};

const report = { minutes, runs: [100, 300, 1000].map(measure) };
const directory = resourcesPath("settlement-previews", "crowd-cpu");
mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, `receipt-${label}.json`),
  JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
