import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, freemem, loadavg } from "node:os";
import { dirname, resolve } from "node:path";

import { stageGameSession } from "../../src/app/settlement/game-session";
import type { OfflineEconomyMetrics } from "../../src/app/settlement/offline-economy";
import type { OfflineIslandMetrics } from "../../src/app/settlement/offline-island-replay";
import { advanceOfflineGame } from "../../src/app/settlement/offline-progress";
import { valueStateKey } from "../../src/shared/settlement/event-core/value-state";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { hashSettlementState } from "../../src/shared/settlement/settlement-state-hash";
import type { Goods } from "../../src/shared/settlement/settlement-types";

/**
 * Checkpoint/continuation acceptance for the offline lanes.
 *
 * Usage from island-of-settlers-client/:
 *   SAVE=../resources/offline-economy/horse-free-2026-10-26/input.json \
 *     OUTPUT=../resources/offline-economy/final-acceptance-2026-10-27/checkpoint.json \
 *     npx tsx tools/acceptance/offline-checkpoint-acceptance.ts
 *
 * The same source bytes are used for fast and exact. Native continuation always runs an explicit
 * exact 60 s fixed-tick replay; the fast lane uses 120 s calibration unless the environment overrides
 * CALIBRATION_SECONDS. Large saves stay detached; the input file is never written.
 */
type Lane = "fast" | "exact";
interface Run {
  calibrationWallMs: number;
  completedSeconds: number;
  events: number;
  fixedTicks: number;
  gross: Goods;
  lane: Lane;
  metrics: OfflineEconomyMetrics[];
  requestedSeconds: number;
  save: GameSaveV1;
  savedAtCorrect: boolean;
  stageValid: boolean;
  wallMs: number;
}
const sourcePath = resolve(process.env.SAVE ??
  "../resources/offline-economy/horse-free-2026-10-26/input.json");
const outputPath = resolve(process.env.OUTPUT ?? "../resources/offline-economy/final-acceptance-2026-10-27/checkpoint.json");
const fastSeconds = (process.env.FAST_SECONDS ?? "300,3600").split(",").map(Number);
const splitSeconds = Number(process.env.SPLIT_SECONDS ?? 1800);
const calibrationSeconds = Number(process.env.CALIBRATION_SECONDS ?? 120);
if (!fastSeconds.every(value => Number.isFinite(value) && value > 0))
  throw new Error("FAST_SECONDS must be a comma-separated list of positive seconds");
if (!Number.isFinite(splitSeconds) || splitSeconds <= 0) throw new Error("SPLIT_SECONDS must be positive");
if (!Number.isFinite(calibrationSeconds) || calibrationSeconds < 0) throw new Error("CALIBRATION_SECONDS must be non-negative");

const laneOptions = (lane: Lane) => lane === "fast"
  ? { economy: true, economyCalibrationSeconds: calibrationSeconds }
  : { exact: true, eventCore: false };
const add = (target: Goods, source: Readonly<Goods>) => {
  for (const [ware, count] of Object.entries(source)) {
    if (ware.startsWith("~")) continue;
    target[ware] = (target[ware] ?? 0) + count;
  }
};
const goods = (save: GameSaveV1): Goods => {
  const total: Goods = {};
  for (const building of save.settlement.buildings) {
    add(total, building.inventory);
    add(total, building.input);
    add(total, building.output);
  }
  for (const actor of save.settlement.actors) {
    if (actor.ware) add(total, { [actor.ware]: actor.wareUnits ?? 1 });
    if (actor.handcart?.trip?.ware && actor.handcart.cargo)
      add(total, { [actor.handcart.trip.ware]: actor.handcart.cargo });
  }
  for (const ship of save.settlement.naval.fleet.ships) add(total, ship.cargo ?? {});
  return total;
};
const delta = (after: Readonly<Goods>, before: Readonly<Goods>): Goods => {
  const result: Goods = {};
  for (const ware of new Set([...Object.keys(after), ...Object.keys(before)]))
    result[ware] = (after[ware] ?? 0) - (before[ware] ?? 0);
  return result;
};
const compare = (candidate: Readonly<Goods>, exact: Readonly<Goods>) => {
  const wares = [...new Set([...Object.keys(candidate), ...Object.keys(exact)])].sort();
  const rows = wares.map(ware => {
    const reference = exact[ware] ?? 0, actual = candidate[ware] ?? 0;
    return { ware, exact: reference, candidate: actual, minimum: Math.ceil(.60 * reference),
      maximum: Math.floor(1.10 * reference), pass: actual >= Math.ceil(.60 * reference) &&
        actual <= Math.floor(1.10 * reference) };
  });
  const absoluteError = rows.reduce((sum, row) => sum + Math.abs(row.candidate - row.exact), 0);
  const exactTotal = rows.reduce((sum, row) => sum + row.exact, 0);
  return { pass: rows.every(row => row.pass), passRows: rows.filter(row => row.pass).length,
    rows: rows.length, absoluteError, exactTotal,
    normalizedL1: exactTotal ? absoluteError / exactTotal : null, wares: rows };
};
const features = (save: GameSaveV1) => {
  const state = save.settlement, runtime = (save.runtime ?? {}) as {
    growth?: { planted?: unknown[]; removed?: unknown[] };
    animals?: { spawner?: { births?: number }; time?: number };
    stone?: { formations?: unknown[]; props?: unknown[]; seams?: unknown[] };
  };
  return {
    actors: state.actors.length,
    animalBirths: runtime.animals?.spawner?.births ?? null,
    animalTime: runtime.animals?.time ?? null,
    buildings: state.buildings.length,
    handcarts: state.actors.filter(actor => actor.handcart).length,
    pendingDeliveries: state.actors.filter(actor => actor.delivery).length,
    reservedDeliveries: state.actors.filter(actor => actor.delivery?.reserved).length,
    ships: state.naval.fleet.ships.length,
    stoneFormations: runtime.stone?.formations?.length ?? 0,
    stoneProps: runtime.stone?.props?.length ?? 0,
    stoneRest: state.stoneRespawns?.length ?? 0,
    stoneSeams: runtime.stone?.seams?.length ?? 0,
    treePlantings: runtime.growth?.planted?.length ?? 0,
    treesRemoved: runtime.growth?.removed?.length ?? 0
  };
};
const fingerprint = async (save: GameSaveV1) => {
  const loaded = await stageGameSession(save);
  const value = { player: save.player, runtime: loaded.runtime, settlement: loaded.settlement };
  return {
    e1: valueStateKey(value),
    e2: hashSettlementState({ runtime: loaded.runtime, settlement: loaded.settlement, world: loaded.map.world })
  };
};
const run = async (source: GameSaveV1, seconds: number, lane: Lane): Promise<Run> => {
  const gross: Goods = {};
  const metrics: OfflineEconomyMetrics[] = [], islandMetrics: OfflineIslandMetrics[] = [];
  let calibrationWallMs = 0, completedSeconds = 0;
  const started = performance.now();
  const save = await advanceOfflineGame(structuredClone(source), source.savedAt + seconds * 1000, progress => {
    completedSeconds = progress.completedSeconds;
  }, {
    ...laneOptions(lane),
    onProductionCycle: (_island, _building, _consumed, output) => {
      if (output) add(gross, { [output]: 1 });
    },
    onEconomyMetrics: report => {
      metrics.push(report);
      for (const island of report.production) add(gross, island.produced);
    },
    onIslandMetrics: report => {
      islandMetrics.push(report);
      if (lane === "fast") calibrationWallMs += report.wallMs;
    }
  });
  let stageValid = true;
  try { await stageGameSession(save); } catch { stageValid = false; }
  const events = metrics.reduce((sum, entry) => sum + entry.events, 0);
  const fixedTicks = islandMetrics.reduce((sum, entry) => sum + entry.fixedTicks, 0);
  return {
    calibrationWallMs, completedSeconds, events, fixedTicks, gross, lane, metrics,
    requestedSeconds: seconds, save,
    savedAtCorrect: save.savedAt === source.savedAt + seconds * 1000, stageValid,
    wallMs: performance.now() - started
  };
};
const runSummary = (value: Run) => ({
  calibrationWallMs: Math.round(value.calibrationWallMs),
  completedSeconds: value.completedSeconds,
  events: value.events,
  featureState: features(value.save),
  fixedTicks: value.fixedTicks,
  gross: value.gross,
  lane: value.lane,
  requestedSeconds: value.requestedSeconds,
  savedAtCorrect: value.savedAtCorrect,
  stageValid: value.stageValid,
  wallMs: Math.round(value.wallMs)
});
const continuation = async (source: GameSaveV1) => {
  const before = goods(source);
  const started = performance.now();
  const save = await advanceOfflineGame(structuredClone(source), source.savedAt + 60_000, () => {},
    { exact: true, eventCore: false });
  const loaded = await stageGameSession(save);
  return {
    actors: save.settlement.actors.length,
    buildings: save.settlement.buildings.length,
    fixedTicks: (loaded.settlement.gameTick ?? 0) - (source.settlement.gameTick ?? 0),
    goodsDelta: delta(goods(save), before),
    savedAtCorrect: save.savedAt === source.savedAt + 60_000,
    stageValid: true,
    wallMs: Math.round(performance.now() - started)
  };
};
const zeroGap = async (source: GameSaveV1, lane: Lane) => {
  const same = await advanceOfflineGame(source, source.savedAt, () => {}, laneOptions(lane));
  const backwards = await advanceOfflineGame(source, source.savedAt - 1000, () => {}, laneOptions(lane));
  return {
    backwardsSameReference: backwards === source,
    sameReference: same === source,
    sameJson: JSON.stringify(same) === JSON.stringify(source)
  };
};

const bytes = await readFile(sourcePath);
const source = JSON.parse(bytes.toString("utf8")) as GameSaveV1;
const inputHash = createHash("sha256").update(bytes).digest("hex");
const sourceGoods = goods(source);
const originalDeliveryUids = new Set(source.settlement.actors.filter(actor => actor.delivery).map(actor => actor.uid));
const host = { cpu: cpus()[0]?.model, logicalCpus: cpus().length, loadAverage: loadavg(),
  freeMemoryBytes: freemem(), platform: process.platform };
const runs: Record<string, Run> = {};
for (const seconds of fastSeconds) {
  runs[`fast-${seconds}`] = await run(source, seconds, "fast");
  runs[`exact-${seconds}`] = await run(source, seconds, "exact");
}
const splitFastMiddle = await run(source, splitSeconds, "fast");
const splitFast = await run(splitFastMiddle.save, splitSeconds, "fast");
const splitExactMiddle = await run(source, splitSeconds, "exact");
const splitExact = await run(splitExactMiddle.save, splitSeconds, "exact");
const longest = Math.max(...fastSeconds);
const continuousFast = runs[`fast-${longest}`]!;
const continuousExact = runs[`exact-${longest}`]!;
const longestSeconds = longest;
const splitFastCompare = compare(splitFast.gross, continuousFast.gross);
const splitExactCompare = compare(splitExact.gross, continuousExact.gross);
const [splitFastFingerprint, continuousFastFingerprint, splitExactFingerprint,
  continuousExactFingerprint] = await Promise.all([
  fingerprint(splitFast.save), fingerprint(continuousFast.save), fingerprint(splitExact.save),
  fingerprint(continuousExact.save)
]);
const endpointContinuations: Record<string, Awaited<ReturnType<typeof continuation>>> = {};
const zeroGapChecks: Record<string, Awaited<ReturnType<typeof zeroGap>>> = {};
for (const [name, value] of Object.entries({ ...runs, "fast-split": splitFast, "exact-split": splitExact })) {
  endpointContinuations[name] = await continuation(value.save);
  zeroGapChecks[name] = await zeroGap(value.save, value.lane);
}
const endpointSave = (name: string) => {
  if (name === "fast-split") return splitFast.save;
  if (name === "exact-split") return splitExact.save;
  return runs[name]!.save;
};
const deliveryAfter = ["fast-300", "fast-3600", "fast-split", "exact-split"].map(name => {
  const remaining = new Set(endpointSave(name).settlement.actors
    .filter(actor => actor.delivery).map(actor => actor.uid));
  return { name, originalPending: originalDeliveryUids.size,
    stillPending: [...originalDeliveryUids].filter(uid => remaining.has(uid)).length,
    completed: [...originalDeliveryUids].filter(uid => !remaining.has(uid)).length };
});
const report = {
  generatedAt: new Date().toISOString(),
  input: sourcePath, inputHash, sourceGoods, sourceState: features(source),
  calibrationSeconds, splitSeconds,
  host,
  runs: Object.fromEntries(Object.entries(runs).map(([name, value]) => [name, runSummary(value)])),
  comparisons: Object.fromEntries(fastSeconds.flatMap(seconds => [[`fast-${seconds}-vs-exact-${seconds}`,
    compare(runs[`fast-${seconds}`]!.gross, runs[`exact-${seconds}`]!.gross)]]).concat([
    [`fast-split-${splitSeconds * 2}-vs-continuous-fast`, splitFastCompare],
    [`fast-split-${splitSeconds * 2}-vs-exact-${longestSeconds}`, compare(splitFast.gross, continuousExact.gross)],
    [`exact-split-${splitSeconds * 2}-vs-continuous-exact`, splitExactCompare]
  ])),
  split: {
    fast: { continuous: runSummary(continuousFast), middle: runSummary(splitFastMiddle),
      split: runSummary(splitFast),
      finalE1: splitFastFingerprint.e1 === continuousFastFingerprint.e1,
      finalE2: splitFastFingerprint.e2 === continuousFastFingerprint.e2 },
    exact: { continuous: runSummary(continuousExact), middle: runSummary(splitExactMiddle),
      split: runSummary(splitExact),
      finalE1: splitExactFingerprint.e1 === continuousExactFingerprint.e1,
      finalE2: splitExactFingerprint.e2 === continuousExactFingerprint.e2 }
  },
  deliveries: deliveryAfter,
  endpointContinuations,
  zeroGap: zeroGapChecks,
  scope: "Node CPU acceptance on the current shared workstation. Fast and exact use identical source " +
    "bytes and horizons; native continuation is an explicit exact 60 s replay. Staging validates the " +
    "returned save but does not render/load the UI.",
  limitations: [
    "Approximate fast split recovery calibrates again after each reload; it is reported against both the continuous fast run and the fresh exact reference, not called exact.",
    "Stone rest, pending delivery and renewal mechanics are guarded by focused module tests; the selected owner fixture did not end the 5 min/30 min/1 h checkpoints with a residual stone-rest timer.",
    "No 24 h accuracy, renderer, GPU, browser startup or legal-archipelago claim follows from this tool."
  ]
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output: outputPath, inputHash, comparisons: report.comparisons,
  split: report.split, continuation: Object.fromEntries(Object.entries(endpointContinuations)
    .map(([name, value]) => [name, value.wallMs])) }, null, 2));
