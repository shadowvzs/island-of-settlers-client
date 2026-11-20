import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { stageGameSession } from "../../src/app/settlement/game-session";
import { createOfflineIslandSession, type OfflineIslandMetrics } from
  "../../src/app/settlement/offline-island-replay";
import { valueStateKey } from "../../src/shared/settlement/event-core/value-state";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { hashSettlementState, hashText } from "../../src/shared/settlement/settlement-state-hash";

/**
 * One serialized D6 lane. Uses the real resumable offline session; the default is one
 * `advance(seconds)` call (production-shaped wall time). `--chunk-seconds=1` records one-second
 * chunk p95/p99 including the exact tick loop, the movement guard and the scheduler. The final save
 * is the same save `advanceOfflineGame` commits. Run one lane per process for clean RSS/JIT numbers.
 *
 * Usage:
 *   tsx tools/analysis/d6-tick-skip-bench.ts <save.json> <seconds> <exact|prototype|segmented>
 *     <output.json> [--resume-at=<seconds>] [--no-resume] [--chunk-seconds=1]
 */
const [inputArgument, secondsArgument, laneArgument, outputArgument, ...rest] = process.argv.slice(2);
if (!inputArgument || !secondsArgument || !laneArgument || !outputArgument)
  throw new Error("Usage: d6-tick-skip-bench.ts <save.json> <seconds> <exact|prototype|segmented> <output.json> [--resume-at=<seconds>] [--no-resume]");
const lane = laneArgument;
if (!["exact", "prototype", "segmented"].includes(lane)) throw new Error(`Unknown lane ${lane}`);
const seconds = Number(secondsArgument);
if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("Use positive elapsed seconds");
const resumeAt = Number(rest.find(value => value.startsWith("--resume-at="))?.split("=")[1] ?? "30");
const chunkSeconds = Number(rest.find(value => value.startsWith("--chunk-seconds="))?.split("=")[1] ?? "0");
const skipResume = rest.includes("--no-resume");
const input = resolve(inputArgument), output = resolve(outputArgument);
const bytes = await readFile(input);
const source = JSON.parse(bytes.toString("utf8")) as GameSaveV1;
const fixtureHash = createHash("sha256").update(bytes).digest("hex");
const flags = lane === "exact"
  ? { exact: true, eventCore: false }
  : { movementSkip: true, movementSkipGuard: lane as "prototype" | "segmented", eventCore: false };

const percentile = (samples: readonly number[], fraction: number) => {
  if (!samples.length) return null;
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))]!;
};

const fullHash = (save: GameSaveV1) => createHash("sha256").update(JSON.stringify(save)).digest("hex");
const fingerprints = async (save: GameSaveV1) => {
  const loaded = await stageGameSession(save);
  return {
    e1: hashText(valueStateKey({
      player: save.player, runtime: loaded.runtime, settlement: loaded.settlement
    })),
    e2: hashSettlementState({ runtime: loaded.runtime, settlement: loaded.settlement, world: loaded.map.world }),
    full: fullHash(save)
  };
};

const rss = () => process.memoryUsage();
const baselineMemory = rss();
let peakRss = baselineMemory.rss;

const run = async (from: GameSaveV1, horizonSeconds: number, startAt: number) => {
  const metrics: OfflineIslandMetrics[] = [];
  const session = await createOfflineIslandSession(from, {
    archipelago: undefined, chronology: "sequential", enemyCampsBlockJumps: false,
    exactBudgetSeconds: 1800, islandId: null,
    mode: "exact", now: startAt + horizonSeconds * 1000, report: () => {},
    seconds: horizonSeconds, start: startAt,
    ...flags, onMetrics: (value: OfflineIslandMetrics) => metrics.push(value)
  });
  const chunks: number[] = [];
  const started = performance.now();
  let elapsed = 0;
  const chunk = chunkSeconds > 0 ? chunkSeconds : horizonSeconds;
  while (elapsed < horizonSeconds - 1e-9) {
    const chunkStarted = performance.now();
    const next = await session.advance(Math.min(chunk, horizonSeconds - elapsed));
    // `advance` yields every ~100 ms; a `--chunk-seconds=1` run records that interval as a sample.
    chunks.push(performance.now() - chunkStarted);
    const memory = rss();
    if (memory.rss > peakRss) peakRss = memory.rss;
    if (next <= elapsed + 1e-9 || next >= horizonSeconds - 1e-6) break;
    elapsed = next;
  }
  const wallMs = performance.now() - started;
  const savedAt = startAt + horizonSeconds * 1000;
  const save = await session.save(savedAt);
  return { save, metrics: metrics[0]!, wallMs, chunks, memory: rss(), elapsed };
};

const mainCpuStart = process.cpuUsage();
const main = await run(source, seconds, source.savedAt);
const mainCpu = process.cpuUsage(mainCpuStart);
const hashes = await fingerprints(main.save);
let resume: Record<string, unknown> | undefined;
if (!skipResume) {
  // A checkpoint inside the skipped stretch: replay `resumeAt` seconds, save, then resume 60 s.
  const checkpoint = resumeAt > 0 && resumeAt < seconds ? await run(source, resumeAt, source.savedAt) : main;
  const resumed = await run(checkpoint.save, 60, checkpoint.save.savedAt);
  resume = {
    checkpointSeconds: checkpoint === main ? seconds : resumeAt,
    wallMs: resumed.wallMs,
    chunks: {
      count: resumed.chunks.length,
      meanMs: resumed.chunks.reduce((sum, value) => sum + value, 0) / Math.max(1, resumed.chunks.length),
      p95Ms: percentile(resumed.chunks, .95), p99Ms: percentile(resumed.chunks, .99),
      maxMs: Math.max(...resumed.chunks)
    },
    metrics: resumed.metrics,
    hashes: await fingerprints(resumed.save)
  };
}
const finalMemory = rss();
const result = {
  fixture: input, fixtureHash, lane, seconds,
  flags, savedAt: main.save.savedAt,
  wallMs: main.wallMs,
  cpu: { userMs: mainCpu.user / 1000, systemMs: mainCpu.system / 1000,
    totalMs: (mainCpu.user + mainCpu.system) / 1000 },
  gameSecondsPerWallSecond: seconds / (main.wallMs / 1000),
  fixedTicks: main.metrics.fixedTicks,
  movement: {
    skips: main.metrics.movementSkips, skippedTicks: main.metrics.movementTicks,
    segments: main.metrics.movementSegments, actorTicks: main.metrics.movementActorTicks,
    skippedSeconds: main.metrics.skippedSeconds, work: main.metrics.movementWork
  },
  chunks: {
    count: main.chunks.length,
    meanMs: main.chunks.reduce((sum, value) => sum + value, 0) / Math.max(1, main.chunks.length),
    p50Ms: percentile(main.chunks, .5), p95Ms: percentile(main.chunks, .95),
    p99Ms: percentile(main.chunks, .99), maxMs: Math.max(...main.chunks)
  },
  memory: {
    baselineRss: baselineMemory.rss, peakRss, finalRss: finalMemory.rss,
    baselineHeapUsed: baselineMemory.heapUsed, finalHeapUsed: finalMemory.heapUsed,
    baselineExternal: baselineMemory.external, finalExternal: finalMemory.external,
    persistentHeapGrowth: finalMemory.heapUsed - baselineMemory.heapUsed
  },
  hashes, resume,
  scope: "Node CPU, one process per lane, one-second real offline-session chunks; not a browser benchmark."
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ lint: "d6-bench", fixtureHash, lane, seconds, wallMs: main.wallMs,
  fixedTicks: main.metrics.fixedTicks, skippedTicks: main.metrics.movementTicks,
  segments: main.metrics.movementSegments, hashes, output }));
