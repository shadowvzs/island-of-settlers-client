import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { stageGameSession } from "../../src/app/settlement/game-session";
import { createIslandStockContacts } from "../../src/app/settlement/island-stock-contacts";
import { createOfflineIslandRuntime } from "../../src/app/settlement/offline-island-runtime";
import { isBuildingCourtyardPointWalkable } from "../../src/render-common/buildings/building-courtyard";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import type { DoorWaitSnapshot } from "../../src/shared/settlement/settlement-door-wait-metrics";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { SettlementActor } from "../../src/shared/settlement/settlement-types";
import { savedHomeBuilding } from "./helpers";

/**
 * Live-play door-wait receipt for one owner save. `savedAt` is stamped to the tool start so the
 * authoritative CPU continuation measures current play rather than a multi-day offline catch-up.
 * The metric is the storage-door FIFO registration-to-admission wait (settlement-door-wait-metrics).
 *
 * Usage: npx tsx tools/analysis/owner-save-door-wait.ts [source-save.json] [output-directory]
 * Env: DOOR_WAIT_SECONDS (default 600), DOOR_WAIT_MAX_ACTIVE (report-only sanity, default none).
 */
const sourcePath = resolve(process.argv[2] ??
  process.env.DOOR_WAIT_SAVE ?? "/home/shadowvzs/Downloads/island-settlers-2026-10-20 (4).json");
const output = resolve(process.argv[3] ??
  process.env.DOOR_WAIT_OUTPUT ?? "../resources/project-reviews/runtime-door-wait-save4");
const seconds = Number(process.env.DOOR_WAIT_SECONDS ?? 600);
const earlyStop = process.env.DOOR_WAIT_EARLY_STOP === "1";
const metricsEnabled = process.env.DOOR_WAIT_METRICS !== "0";
const traceUid = Number(process.env.DOOR_WAIT_TRACE_UID ?? NaN);
const tick = .05;
const arrivalPhases = new Set(["home", "retire", "pickup", "deliver"]);
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const round = (value: number) => +value.toFixed(3);
const percentile = (values: number[], fraction: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
};

const originalBytes = await readFile(sourcePath);
const source = JSON.parse(originalBytes.toString("utf8")) as GameSaveV1;
const liveStartedAt = Date.now();
const liveSource: GameSaveV1 = { ...source, savedAt: liveStartedAt };
const liveBytes = Buffer.from(JSON.stringify(liveSource));
await mkdir(output, { recursive: true });
await writeFile(join(output, basename(sourcePath)), originalBytes);
await writeFile(join(output, "live-stamped.json"), liveBytes);

const loaded = await stageGameSession(liveSource), { world } = loaded.map;
const runtime = createOfflineIslandRuntime(loaded);
let elapsed = 0;
let simulation: ReturnType<typeof createSettlementSimulation>;
const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
simulation = createSettlementSimulation({ world, roads, ...runtime.hooks,
  homeBuilding: savedHomeBuilding(loaded.settlement.buildings.find(building => building.typeId === 0 || building.colonyHome)),
  playerNation: loaded.settlement.playerNation, now: () => liveStartedAt + elapsed * 1000,
  stockContact: createIslandStockContacts(world),
  canWorkerEnterPlot: (building, point) => building.construction < 1 ||
    isBuildingCourtyardPointWalkable(building.typeId, building.x, building.z, building.rotation,
      point, building.output, building.input) });
const restored = simulation.loadState(loaded.settlement);
if (!restored.ok) throw new Error(restored.reason);
if (metricsEnabled) simulation.enableDoorWaitMetrics();
const home = simulation.headquarters;
const arrivalBuilding = (actor: SettlementActor) => {
  if (["pickup", "enterPickup"].includes(actor.phase)) return actor.delivery?.source;
  if (["deliver", "enterDelivery"].includes(actor.phase)) return actor.delivery?.destination;
  return actor.home;
};
const hqArrivals = () => simulation.frames().filter(actor =>
  actor.visible && arrivalPhases.has(actor.phase) && arrivalBuilding(actor) === home.uid);
const initialHqArrivals = hqArrivals().map(actor => ({
  job: actor.job, phase: actor.phase, uid: actor.uid
}));
const initialUids = new Set(initialHqArrivals.map(actor => actor.uid));
const initialOrders = new Map(simulation.frames().map(actor =>
  [actor.uid, actor.storageArrivalOrder] as const));
const completedByUid = new Map<number, number>();
const goneInitial = new Set<number>();
const samples: unknown[] = [];
const trace: unknown[] = [];
let maxHqWait = 0, maxHqUid = 0, maxHqJob = "", maxHqKind = "", maxHqPhase = "";
let maxAllWait = 0, maxAllUid = 0, maxAllJob = "", maxAllKind = "", maxAllPhase = "";
let maxDoorBuilding = 0;
let hqEmptyTicks = 0, maxHqEmptyTicks = 0, drainedAt = 0, initialClearedAt = 0;
let steadyMaxActive = 0;
let backlogCheckpoint: unknown;
let lastSnapshot: DoorWaitSnapshot | undefined;
const observeSnapshot = (metrics: DoorWaitSnapshot) => {
  lastSnapshot = metrics;
  for (const sample of metrics.completed) {
    const known = completedByUid.get(sample.uid) ?? 0;
    if (sample.seconds > known) completedByUid.set(sample.uid, sample.seconds);
  }
  const consider = (wait: { building: number; job: string; kind: string; phase: string;
    seconds: number; uid: number }) => {
    if (wait.building === home.uid && wait.seconds > maxHqWait) {
      maxHqWait = wait.seconds; maxHqUid = wait.uid; maxHqJob = wait.job;
      maxHqKind = wait.kind; maxHqPhase = wait.phase;
    }
    if (wait.seconds > maxAllWait) {
      maxAllWait = wait.seconds; maxAllUid = wait.uid; maxDoorBuilding = wait.building;
      maxAllJob = wait.job; maxAllKind = wait.kind; maxAllPhase = wait.phase;
    }
  };
  for (const wait of [...metrics.completed, ...metrics.departureCompleted]) consider(wait);
  for (const wait of [...metrics.active, ...metrics.departureActive]) consider(wait);
  const hqActive = metrics.active.filter(active => active.building === home.uid);
  if (initialClearedAt) steadyMaxActive = Math.max(steadyMaxActive,
    ...hqActive.map(active => active.seconds));
  const waitingInitial = hqArrivals().filter(actor => initialUids.has(actor.uid)).length;
  for (const uid of initialUids) {
    if (!simulation.frames().some(actor => actor.uid === uid && arrivalPhases.has(actor.phase)))
      goneInitial.add(uid);
  }
  hqEmptyTicks = hqActive.length === 0 && waitingInitial === 0 ? hqEmptyTicks + tick : 0;
  maxHqEmptyTicks = Math.max(maxHqEmptyTicks, hqEmptyTicks);
  if (hqEmptyTicks >= 5 && !drainedAt) drainedAt = elapsed - 5;
  const allInitialSettled = [...initialUids].every(uid => completedByUid.has(uid) || goneInitial.has(uid) ||
    !simulation.frames().some(actor => actor.uid === uid && arrivalPhases.has(actor.phase)));
  if (allInitialSettled && !initialClearedAt) {
    initialClearedAt = elapsed;
    backlogCheckpoint = simulation.saveState();
  }
  return { hqActive: hqActive.length, waitingInitial };
};
const ticks = Math.round(seconds / tick);
for (let index = 0; index < ticks; index++) {
  simulation.update(tick);
  elapsed += tick;
  const metrics = simulation.doorWaitMetrics();
  const state = observeSnapshot(metrics);
  if (Number.isFinite(traceUid) && (index + 1) % 10 === 0) {
    const actor = simulation.frames().find(candidate => candidate.uid === traceUid);
    trace.push(actor ? {
      active: metrics.active.find(active => active.uid === traceUid)?.seconds ?? null,
      arrivalBuilding: actor.storageArrivalBuilding ?? null,
      arrivalOrder: actor.storageArrivalOrder ?? null,
      phase: actor.phase, seconds: round(elapsed), visible: actor.visible,
      x: round(actor.x), z: round(actor.z)
    } : { absent: true, seconds: round(elapsed) });
  }
  if ((index + 1) % 20 === 0 || index === ticks - 1) {
    const queue = {
      completed: metrics.completedCount,
      completedDepartures: metrics.departureCount,
      completedHq: metrics.completed.filter(sample => sample.building === home.uid).length,
      departuresActive: metrics.departureActiveCount,
      hqActive: state.hqActive,
      maxDepartureObserved: round(metrics.maxDepartureObservedSeconds),
      maxObserved: round(metrics.maxObservedSeconds),
      p95: round(metrics.p95CompletedSeconds),
      seconds: round(elapsed),
      waitingInitial: state.waitingInitial
    };
    samples.push(queue);
    if ((index + 1) % 200 === 0) console.log(JSON.stringify(queue));
  }
  if (earlyStop && elapsed >= 300 + 20 && drainedAt && initialClearedAt) break;
}
const metrics = lastSnapshot ?? simulation.doorWaitMetrics();
const finalHqActive = metrics.active.filter(active => active.building === home.uid).length;
const finalWaitingInitial = hqArrivals().filter(actor => initialUids.has(actor.uid)).length;
const completed = metrics.completed.sort((a, b) => b.seconds - a.seconds);
const departures = metrics.departureCompleted.sort((a, b) => b.seconds - a.seconds);
const backlogCutoff = initialClearedAt || 0;
const initialArrivals = completed.filter(sample => sample.completedAt <= backlogCutoff + tick);
const steadyArrivals = completed.filter(sample => sample.completedAt > backlogCutoff + tick);
const waitStats = (samples: typeof completed) => ({
  completed: samples.length,
  maxSeconds: round(Math.max(0, ...samples.map(sample => sample.seconds))),
  p95Seconds: round(percentile(samples.map(sample => sample.seconds), .95))
});
const allCompleted = [...completed, ...departures].sort((a, b) => b.seconds - a.seconds);
const completedHq = completed.filter(sample => sample.building === home.uid);
const longest = allCompleted.slice(0, 25).map(sample => ({
  building: sample.building, completedAt: round(sample.completedAt), job: sample.job,
  kind: sample.kind, phase: sample.phase, seconds: round(sample.seconds),
  startedAt: round(sample.startedAt), uid: sample.uid
}));
const completionTimeline = [...completed].sort((a, b) => a.completedAt - b.completedAt).map(sample => ({
  at: round(sample.completedAt), kind: sample.kind, seconds: round(sample.seconds), uid: sample.uid
}));
const seenInitial = new Set<number>();
const initialCompletions = [...completed].filter(sample => initialUids.has(sample.uid))
  .sort((a, b) => a.completedAt - b.completedAt)
  .filter(sample => {
    if (seenInitial.has(sample.uid)) return false;
    seenInitial.add(sample.uid);
    return true;
  });
let previousOrder = -1, fifoInversions = 0;
for (const sample of initialCompletions) {
  const order = initialOrders.get(sample.uid);
  if (order === undefined) continue;
  if (order < previousOrder) fifoInversions++;
  previousOrder = order;
}
const departureTimeline = [...departures].sort((a, b) => a.completedAt - b.completedAt).map(sample => ({
  at: round(sample.completedAt), kind: sample.kind, seconds: round(sample.seconds), uid: sample.uid
}));
const final = simulation.saveState();
await writeFile(join(output, "final.settlement.json"), JSON.stringify(final));
await writeFile(join(output, "checkpoint-end.settlement.json"), JSON.stringify(final));
if (backlogCheckpoint)
  await writeFile(join(output, "checkpoint-initial-backlog-cleared.settlement.json"),
    JSON.stringify(backlogCheckpoint));
await writeFile(join(output, "completed-waits.json"), JSON.stringify(completed.map(sample => ({
  ...sample, seconds: round(sample.seconds)
})), null, 2));
await writeFile(join(output, "departure-waits.json"), JSON.stringify(departures.map(sample => ({
  ...sample, seconds: round(sample.seconds)
})), null, 2));
if (trace.length) await writeFile(join(output, "trace.json"), JSON.stringify(trace, null, 2));
const initialStatus = initialHqArrivals.map(actor => ({
  completedSeconds: completedByUid.has(actor.uid) ? round(completedByUid.get(actor.uid)!) : null,
  job: actor.job, phase: actor.phase, uid: actor.uid,
  stillArriving: simulation.frames().some(current => current.uid === actor.uid &&
    arrivalPhases.has(current.phase) && arrivalBuilding(current) === home.uid)
}));
const report = {
  metric: {
    definition: "Arrivals: seconds from storage-door FIFO registration to admission (cleared to walk to " +
      "the access). Departures: seconds from the hidden crew's door request to permission to leave. " +
      "The maximum active wait is sampled every traffic tick.",
    enabled: metricsEnabled,
    source: "island-of-settlers-client/src/shared/settlement/settlement-door-wait-metrics.ts",
    tickSeconds: tick, unit: "simulated seconds"
  },
  source: { path: sourcePath, sha256: hash(originalBytes), savedAt: source.savedAt },
  live: {
    path: join(output, "live-stamped.json"), savedAt: liveStartedAt, sha256: hash(liveBytes),
    stamping: "savedAt replaced with the tool start timestamp; no offline catch-up ran"
  },
  run: {
    activeAtEnd: metrics.activeCount, activeDeparturesAtEnd: metrics.departureActiveCount,
    completedArrivals: metrics.completedCount, completedDepartures: metrics.departureCount,
    completedHqArrivals: completedHq.length, seconds: round(elapsed), ticks: Math.round(elapsed / tick)
  },
  checkpoint: {
    end: join(output, "checkpoint-end.settlement.json"),
    initialBacklogCleared: backlogCheckpoint
      ? join(output, "checkpoint-initial-backlog-cleared.settlement.json") : null,
    liveStampedInput: join(output, "live-stamped.json")
  },
  summary: {
    activeAtEnd: metrics.active.map(active => ({
      building: active.building, job: active.job, kind: active.kind, phase: active.phase,
      seconds: round(active.seconds), uid: active.uid
    })),
    departureActiveAtEnd: metrics.departureActive.map(active => ({
      building: active.building, job: active.job, phase: active.phase,
      seconds: round(active.seconds), uid: active.uid
    })),
    drained: drainedAt > 0,
    drainedAtSeconds: drainedAt ? round(drainedAt) : null,
    finalHqActive,
    finalWaitingInitial,
    initialBacklog: waitStats(initialArrivals),
    initialBacklogClearedAtSeconds: initialClearedAt ? round(initialClearedAt) : null,
    queueEmptyAtEnd: finalHqActive === 0 && finalWaitingInitial === 0,
    steadyState: { ...waitStats(steadyArrivals), maxActiveWaitSeconds: round(steadyMaxActive) },
    longest,
    maxDoorWait: {
      building: maxDoorBuilding, job: maxAllJob, kind: maxAllKind, phase: maxAllPhase,
      seconds: round(maxAllWait), uid: maxAllUid
    },
    maxHqWait: {
      job: maxHqJob, kind: maxHqKind, phase: maxHqPhase, seconds: round(maxHqWait), uid: maxHqUid
    },
    maxDepartureObservedSeconds: round(metrics.maxDepartureObservedSeconds),
    maxObservedSeconds: round(metrics.maxObservedSeconds),
    p95CompletedSeconds: round(metrics.p95CompletedSeconds),
    p95DepartureSeconds: round(metrics.p95DepartureSeconds),
    p95HqSeconds: round(percentile(completedHq.map(sample => sample.seconds), .95)),
    queueEmptyGapSeconds: round(maxHqEmptyTicks)
  },
  initialHqArrivals: initialStatus,
  initialFifo: {
    completed: initialCompletions.length,
    inversions: fifoInversions,
    ordered: initialCompletions.filter(sample => initialOrders.get(sample.uid) !== undefined).length,
    sequence: initialCompletions.map(sample => ({
      at: round(sample.completedAt), order: initialOrders.get(sample.uid) ?? null, uid: sample.uid
    }))
  },
  completionTimeline,
  departureTimeline,
  samples
};
await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  completedDepartures: report.run.completedDepartures,
  completed: report.run.completedArrivals,
  drained: report.summary.drained,
  drainedAt: report.summary.drainedAtSeconds,
  maxDoorWait: report.summary.maxDoorWait,
  maxHqWait: report.summary.maxHqWait,
  p95: report.summary.p95CompletedSeconds,
  p95Departure: report.summary.p95DepartureSeconds,
  seconds: report.run.seconds
}, null, 2));
