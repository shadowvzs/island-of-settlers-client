import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { OfflineIslandMetrics } from "../../src/app/settlement/offline-island-replay";
import { advanceOfflineGame, type OfflineProgress, type OfflineReplayOptions } from "../../src/app/settlement/offline-progress";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";

/**
 * Repeated-chunk offline benchmark matching the server's background catch-up shape: each call
 * advances at most `chunkSeconds` from the previous save, then the next call starts from that save.
 * This is not the API path (no DB/history/worker contention); it measures the simulation cost of
 * restarting measurement state per chunk.
 *
 * Usage: tsx tools/analysis/offline-chunk-cost.ts <save.json> <report.json> \
 *   [totalSeconds=86400] [chunkSeconds=600] [exact|measured|chronological] [wallLimitMs=1800000]
 */
const [inputArgument, outputArgument, totalArgument = "86400", chunkArgument = "600",
  modeArgument = "exact", limitArgument = "1800000"] = process.argv.slice(2);
if (!inputArgument || !outputArgument)
  throw new Error("Usage: offline-chunk-cost.ts <save.json> <report.json> [totalSeconds] [chunkSeconds] [exact|measured|chronological] [wallLimitMs]");
const totalSeconds = Number(totalArgument), chunkSeconds = Number(chunkArgument);
const wallLimitMs = Number(limitArgument);
if (!Number.isFinite(totalSeconds) || totalSeconds <= 0 ||
  !Number.isFinite(chunkSeconds) || chunkSeconds <= 0 || chunkSeconds > totalSeconds ||
  !Number.isFinite(wallLimitMs) || wallLimitMs < 1000)
  throw new Error("Use positive total/chunk seconds and a wall limit of at least 1000 ms");
if (!["exact", "measured", "chronological"].includes(modeArgument))
  throw new Error("mode must be exact, measured or chronological");
const input = resolve(inputArgument), output = resolve(outputArgument);
const bytes = await readFile(input), source = JSON.parse(bytes.toString("utf8")) as GameSaveV1;
const replayOptions = (mode: string): OfflineReplayOptions => {
  if (mode === "exact") return { exact: true, eventCore: false, chronological: false };
  if (mode === "chronological") return { chronological: true, exact: true, eventCore: false };
  // `measured` is the explicit experimental opt-in; exact is the default.
  return { measured: true };
};
const options = replayOptions(modeArgument);
const islands: OfflineIslandMetrics[] = [];
const chunks: Array<{ at: number; elapsedMs: number; gameSeconds: number; fixedTicks: number;
  mode: string; skippedSeconds: number; wallMs: number }> = [];
const started = performance.now();
let current = source, completed = 0, lastOutput = 0;
const limit = new Error("chunk benchmark wall-time limit reached");
try {
  while (completed < totalSeconds - 1e-9) {
    const step = Math.min(chunkSeconds, totalSeconds - completed);
    const target = current.savedAt + step * 1000;
    const chunkStarted = performance.now();
    let metrics: OfflineIslandMetrics | undefined;
    current = await advanceOfflineGame(current, target, (value: OfflineProgress) => {
      if (performance.now() - started > wallLimitMs) throw limit;
      if (performance.now() - lastOutput >= 5000) {
        lastOutput = performance.now();
        console.log(JSON.stringify({ completedSeconds: completed + value.completedSeconds,
          elapsedMs: Math.round(performance.now() - started) }));
      }
    }, { ...options, onIslandMetrics: value => { metrics = value; islands.push(value); } });
    const elapsedMs = performance.now() - chunkStarted;
    if (metrics) {
      chunks.push({ at: target, elapsedMs, gameSeconds: metrics.gameSeconds,
        fixedTicks: metrics.fixedTicks, mode: metrics.mode, skippedSeconds: metrics.skippedSeconds,
        wallMs: metrics.wallMs });
    }
    completed += step;
    if (performance.now() - started > wallLimitMs) throw limit;
  }
} catch (caught) {
  if (caught !== limit) throw caught;
}
const elapsedMs = performance.now() - started;
const skippedSeconds = islands.reduce((sum, island) => sum + island.skippedSeconds, 0);
const fixedTicks = islands.reduce((sum, island) => sum + island.fixedTicks, 0);
const result = {
  input, inputHash: createHash("sha256").update(bytes).digest("hex"),
  totalSeconds, chunkSeconds, mode: modeArgument, complete: completed >= totalSeconds - 1e-9,
  elapsedMs, chunks: chunks.length, fixedTicks, skippedSeconds,
  gameSecondsPerWallSecond: elapsedMs ? completed / (elapsedMs / 1000) : null,
  averageChunkWallMs: chunks.length ? elapsedMs / chunks.length : null,
  modes: [...new Set(islands.map(island => island.mode))],
  fallbackReasons: [...new Set(islands.map(island => island.fallbackReason).filter(Boolean))],
  chunkReport: chunks,
  scope: "Repeated client-side chunks; excludes server DB/history, snapshot compression, queueing and contention."
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
if (!result.complete) process.exitCode = 2;
