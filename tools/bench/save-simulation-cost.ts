import { readFileSync } from "node:fs";

import { TICK_SECONDS } from "../../../island-of-settlers-shared/src/time/constants";
import { createHeadlessIsland } from "../../src/app/settlement/headless-replay";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { groundSearchMemoWork } from "../../src/shared/settlement/ground-search-memo";
import { trafficWork } from "../../src/shared/settlement/settlement-traffic-counters";

/**
 * Simulation CPU of a supplied save, headless and deterministic (no renderer, no browser): per
 * fixed 50 ms tick wall time, ground searches and visits, and ticks that threw. A stranded walker
 * re-searching the island shows up here first (perf lane 2026-11-07: 2298 ms per simulated second).
 *
 * Usage: npx tsx tools/bench/save-simulation-cost.ts <save.json> [seconds=60]
 */
const WINDOW_TICKS = 100;

const file = process.argv[2];
if (!file) throw new Error("Usage: save-simulation-cost.ts <save.json> [seconds]");
const seconds = Number(process.argv[3] ?? 60);
const island = await createHeadlessIsland(JSON.parse(readFileSync(file, "utf8")) as GameSaveV1);
const { simulation } = island;
for (const _progress of simulation.prewarmCoastalGeometry()) { /* Derived caches only. */ }

const ticks = Math.round(seconds / TICK_SECONDS);
const tickMs: number[] = [];
const errors = new Map<string, number>();
const windows: string[] = [];
const start = { searches: trafficWork.groundSearches, visits: trafficWork.groundVisits };
let window = { ms: 0, searches: trafficWork.groundSearches, visits: trafficWork.groundVisits };

const closeWindow = (tick: number) => {
  const searches = trafficWork.groundSearches - window.searches;
  const visits = Math.round((trafficWork.groundVisits - window.visits) / 1000);
  windows.push(`${(tick * TICK_SECONDS).toFixed(0)}s ${window.ms.toFixed(0)}ms ${searches}s ${visits}kv`);
  window = { ms: 0, searches: trafficWork.groundSearches, visits: trafficWork.groundVisits };
};

for (let tick = 1; tick <= ticks; tick++) {
  const started = performance.now();
  try { simulation.update(TICK_SECONDS); }
  catch (error) {
    const key = String((error as Error).stack ?? error).split("\n").slice(0, 2).join(" | ");
    errors.set(key, (errors.get(key) ?? 0) + 1);
  }
  const elapsed = performance.now() - started;
  tickMs.push(elapsed);
  window.ms += elapsed;
  if (tick % WINDOW_TICKS === 0) closeWindow(tick);
}

const sorted = [...tickMs].sort((a, b) => a - b);
const percentile = (fraction: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!.toFixed(2);
const total = tickMs.reduce((sum, value) => sum + value, 0);
console.log(JSON.stringify({
  errors: [...errors.values()].reduce((sum, count) => sum + count, 0),
  maxTickMs: sorted.at(-1)!.toFixed(1),
  memo: groundSearchMemoWork,
  meanTickMs: (total / ticks).toFixed(2),
  msPerSimulatedSecond: (total / seconds).toFixed(1),
  p50TickMs: percentile(.5),
  p95TickMs: percentile(.95),
  p99TickMs: percentile(.99),
  searches: trafficWork.groundSearches - start.searches,
  simulatedSeconds: seconds,
  visits: trafficWork.groundVisits - start.visits
}));
console.log(`per ${WINDOW_TICKS * TICK_SECONDS} s (wall ms / searches / thousand visits):`, windows.join(", "));
for (const [error, count] of errors) console.log(`error x${count}: ${error.slice(0, 300)}`);
