import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { stageGameSession } from "../../src/app/settlement/game-session";
import type { OfflineIslandMetrics } from "../../src/app/settlement/offline-island-replay";
import { advanceOfflineGame, type OfflineProgress, type OfflineReplayOptions } from "../../src/app/settlement/offline-progress";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";

const MODES = ["fast", "analytic", "exact", "event-core", "executor", "quiet", "chronological"] as const;
type Mode = (typeof MODES)[number];
const replayOptions = (mode: Mode): OfflineReplayOptions => {
  if (mode === "analytic") return { analytic: true };
  // `exact` is the sequential fixed-tick reference; `chronological` is the coordinated exact run.
  // Both disable event-core auto so the reference and ordering lanes stay true fixed ticks.
  if (mode === "exact") return { exact: true, eventCore: false, chronological: false };
  if (mode === "event-core") return { eventCore: true };
  if (mode === "executor") return { corridorReservations: true, eventMovement: true, exact: true };
  if (mode === "quiet") return { quietSkip: true };
  if (mode === "chronological") return { chronological: true, exact: true, eventCore: false };
  // `fast` is the measured benchmark lane; it must opt in explicitly (exact is the default).
  return { measured: true };
};

/** Bounded CPU diagnostic using real catch-up; never writes the input save. */
const [inputArgument, outputArgument, secondsArgument = "86400", limitArgument = "60000", modeArgument = "fast"] =
  process.argv.slice(2);
if (!inputArgument || !outputArgument)
  throw new Error(`Usage: offline-progress-cost.ts <save.json> <report.json> [seconds] [wall-limit-ms] [${MODES.join("|")}]`);
if (!MODES.includes(modeArgument as Mode))
  throw new Error(`Unknown mode ${modeArgument}; use ${MODES.join(", ")}`);
const mode = modeArgument as Mode;
const input = resolve(inputArgument), output = resolve(outputArgument);
const seconds = Number(secondsArgument), wallLimitMs = Number(limitArgument);
if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(wallLimitMs) || wallLimitMs < 1000)
  throw new Error("Use positive elapsed seconds and a wall limit of at least1000ms");
const bytes = await readFile(input), source = JSON.parse(bytes.toString("utf8")) as GameSaveV1;
const loaded = await stageGameSession(source);
const inputHash = createHash("sha256").update(bytes).digest("hex");
const islands: OfflineIslandMetrics[] = [];
let progress: OfflineProgress = { completedSeconds: 0, totalSeconds: seconds };
let lastOutput = 0, complete = false, error: string | undefined;
let resultSave: GameSaveV1 | undefined, resumeMs: number | null = null;
const started = performance.now();
const limit = new Error("Benchmark wall-time limit reached; catch-up is incomplete");
try {
  resultSave = await advanceOfflineGame(source, source.savedAt + seconds * 1000, value => {
    progress = value;
    const elapsedMs = performance.now() - started;
    if (elapsedMs - lastOutput >= 5000) {
      console.log(JSON.stringify({ completedSeconds: value.completedSeconds, elapsedMs: Math.round(elapsedMs),
        percent: Number((100 * value.completedSeconds / value.totalSeconds).toFixed(2)) }));
      lastOutput = elapsedMs;
    }
    if (elapsedMs > wallLimitMs) throw limit;
  }, { ...replayOptions(mode), onIslandMetrics: metrics => islands.push(metrics) });
  complete = true;
} catch (caught) {
  if (caught !== limit) error = String(caught);
}
const elapsedMs = performance.now() - started;
if (resultSave) {
  const resumeStarted = performance.now();
  await advanceOfflineGame(resultSave, resultSave.savedAt + 60_000, () => {}, replayOptions(mode));
  resumeMs = performance.now() - resumeStarted;
}
const fixedTicks = islands.reduce((sum, island) => sum + island.fixedTicks, 0);
const events = islands.reduce((sum, island) => sum + (island.eventCore?.events ?? 0), 0);
const gameSeconds = islands.reduce((sum, island) => sum + island.gameSeconds, 0);
// Chronological sessions advance in lockstep, so per-island traffic deltas overlap; use the totals.
const result = {
  input, inputHash, map: { x: loaded.map.world.cellsX, z: loaded.map.world.cellsZ },
  buildings: source.settlement.buildings.length, actors: source.settlement.actors.length,
  mode, requestedSeconds: seconds, progress, complete, error, wallLimitMs, elapsedMs,
  resume: { seconds: 60, wallMs: resumeMs },
  islands,
  totals: {
    events,
    fixedTicks,
    gameSeconds,
    quietSkips: islands.reduce((sum, island) => sum + island.quietSkips, 0),
    quietTicks: islands.reduce((sum, island) => sum + island.quietTicks, 0),
    skippedSeconds: islands.reduce((sum, island) => sum + island.skippedSeconds, 0),
    wallMs: Math.round(elapsedMs),
    gameSecondsPerWallSecond: elapsedMs ? gameSeconds / (elapsedMs / 1000) : null,
    ticksPerGameSecond: gameSeconds ? fixedTicks / gameSeconds : null,
    eventsPerGameSecond: gameSeconds ? events / gameSeconds : null
  },
  extrapolatedTotalMs: progress.completedSeconds > 0 ? elapsedMs * progress.totalSeconds / progress.completedSeconds : null,
  scope: "Actual Node CPU catch-up on the current shared workstation; not a browser/phone benchmark. " +
    "Partial-run extrapolation is an estimate; workload can change as production/storage/resources evolve."
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
if (!complete) process.exitCode = 2;
