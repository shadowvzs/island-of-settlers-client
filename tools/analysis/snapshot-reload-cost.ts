import { readFileSync } from "node:fs";
import { PerformanceObserver } from "node:perf_hooks";

import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { hashSettlementState } from "../../src/shared/settlement/settlement-state-hash";
import { createSnapshotSession, type SnapshotSession, STEP } from "./snapshot-session";

/**
 * Cost of the canonical restart at snapshot upload (determinism item 3): the client reloads its own
 * snapshot. Measures each phase (median of REPS), the slow ticks right after, GC and allocation.
 *
 *   node --expose-gc --import tsx tools/analysis/snapshot-reload-cost.ts save.json [--reps 7]
 */
const file = process.argv[2];
if (!file) throw new Error("Usage: snapshot-reload-cost.ts <game save.json> [--reps 7]");
const repsIndex = process.argv.indexOf("--reps");
const REPS = repsIndex < 0 ? 7 : Number(process.argv[repsIndex + 1]);
const WARM_TICKS = 100, BETWEEN_TICKS = 40, AFTER_TICKS = 5;
const gc = (globalThis as { gc?: () => void }).gc;

let gcMs = 0, gcCount = 0;
new PerformanceObserver(list => {
  for (const entry of list.getEntries()) { gcMs += entry.duration; gcCount++; }
}).observe({ entryTypes: ["gc"] });

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const time = <T>(work: () => T): [T, number] => {
  const started = performance.now(), value = work();
  return [value, performance.now() - started];
};
const timeAsync = async <T>(work: () => Promise<T>): Promise<[T, number]> => {
  const started = performance.now(), value = await work();
  return [value, performance.now() - started];
};

const tick = (session: SnapshotSession) => {
  session.clock.elapsed += STEP;
  session.simulation.update(STEP);
};
const ticks = (session: SnapshotSession, count: number) => {
  const costs: number[] = [];
  for (let index = 0; index < count; index++) costs.push(time(() => tick(session))[1]);
  return costs;
};
const settlementHash = (session: SnapshotSession) =>
  hashSettlementState({ settlement: session.simulation.saveState(), world: session.world });

/** In-place restart: the same simulation, world, roads and managers load their own save. */
const inPlace = (session: SnapshotSession) => {
  const before = settlementHash(session);
  const [save, saveMs] = time(() => session.simulation.saveState());
  const [runtime, runtimeSaveMs] = time(() => session.runtime.save());
  const [, cloneMs] = time(() => JSON.parse(JSON.stringify({ runtime, save })) as { save: typeof save });
  const heap = process.memoryUsage().heapUsed;
  // The upload reload: trusted, in place (it clones the snapshot itself).
  const [result, loadMs] = time(() => session.simulation.reloadSnapshot(save));
  if (!result.ok) throw new Error(result.reason);
  const allocatedMb = (process.memoryUsage().heapUsed - heap) / 1e6;
  const stable = before === settlementHash(session);
  const after = ticks(session, AFTER_TICKS);
  return { after, allocatedMb, cloneMs, loadMs, runtimeSaveMs, saveMs, stable };
};

/** Full restart: a new world, roads, navigation, runtime managers and simulation from the save. */
const rebuild = async (session: SnapshotSession) => {
  const [game, gameSaveMs] = await timeAsync(() => session.saveGame());
  const [clone, cloneMs] = time(() => JSON.parse(JSON.stringify(game)) as GameSaveV1);
  const [fresh, rebuildMs] = await timeAsync(() => createSnapshotSession(clone, { elapsed: 0 }));
  const after = ticks(fresh, AFTER_TICKS);
  return { after, cloneMs, gameSaveMs, rebuildMs, sizeMb: JSON.stringify(game).length / 1e6 };
};

const main = async () => {
  const save = JSON.parse(readFileSync(file, "utf8")) as GameSaveV1;
  const [session, firstLoadMs] = await timeAsync(() => createSnapshotSession(save, { elapsed: 0 }));
  const steady = ticks(session, WARM_TICKS);
  const inPlaceRuns: ReturnType<typeof inPlace>[] = [];
  let inPlaceGcMs = 0;
  for (let rep = 0; rep < REPS; rep++) {
    ticks(session, BETWEEN_TICKS); gc?.(); await new Promise(resolve => setTimeout(resolve, 0));
    const gcBefore = gcMs;
    inPlaceRuns.push(inPlace(session));
    await new Promise(resolve => setTimeout(resolve, 0));
    inPlaceGcMs = Math.max(inPlaceGcMs, gcMs - gcBefore);
  }
  const rebuildRuns = [];
  for (let rep = 0; rep < Math.min(REPS, 3); rep++) rebuildRuns.push(await rebuild(session));
  const pick = <T>(runs: T[], key: keyof T) => median(runs.map(run => run[key] as number)).toFixed(2);
  const settlement = session.simulation.saveState();
  console.log(JSON.stringify({
    file: file.split("/").slice(-3).join("/"),
    map: `${session.world.cellsX}x${session.world.cellsZ}`,
    buildings: settlement.buildings.length, actors: settlement.actors.length,
    animals: session.runtime.livingAnimals(), firstLoadMs: firstLoadMs.toFixed(0),
    tickMedianMs: median(steady).toFixed(3), tickMaxMs: Math.max(...steady).toFixed(2),
    inPlace: { saveStateMs: pick(inPlaceRuns, "saveMs"), runtimeSaveMs: pick(inPlaceRuns, "runtimeSaveMs"),
      jsonCloneMs: pick(inPlaceRuns, "cloneMs"), loadStateMs: pick(inPlaceRuns, "loadMs"),
      allocatedMb: pick(inPlaceRuns, "allocatedMb"), maxGcMsInWindow: inPlaceGcMs.toFixed(2),
      firstTickAfterMs: median(inPlaceRuns.map(run => run.after[0]!)).toFixed(2),
      stableHash: inPlaceRuns.map(run => run.stable) },
    rebuild: { gameSaveMs: pick(rebuildRuns, "gameSaveMs"), jsonCloneMs: pick(rebuildRuns, "cloneMs"),
      rebuildMs: pick(rebuildRuns, "rebuildMs"), sizeMb: pick(rebuildRuns, "sizeMb"),
      firstTickAfterMs: median(rebuildRuns.map(run => run.after[0]!)).toFixed(2) },
    gcTotal: { count: gcCount, ms: gcMs.toFixed(1) }
  }, null, 1));
};

await main();
