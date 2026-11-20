import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { createHeadlessIsland, runHeadlessReplay } from "../../src/app/settlement/headless-replay";
import { createBugReplayRecorder } from "../../src/shared/settlement/bug-replay";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { resourcesPath } from "../bench/resources-path";

/**
 * REPLAY-RESTORE-01: run a current owner save through a live HQ-door contention window, capture a
 * fresh same-source reproduction and prove that a restored replay reaches the same endpoint. A
 * halfway save is also restored and continued to the same live state.
 *
 * Usage: replay-restore-current.ts <current-save.json> [seconds]
 */
const file = process.argv[2];
if (!file) throw new Error("Usage: replay-restore-current.ts <current-save.json> [seconds]");
const seconds = Number(process.argv[3] ?? 30);
const source = JSON.parse(readFileSync(file, "utf8")) as GameSaveV1;
if (source.format !== "island-settlers-game" || source.version !== 4)
  throw new Error("Supply a current version-2 game save (old game saves are intentionally discarded)");
const updates = Array.from({ length: Math.round(seconds / .05) }, () => .05);
const baseline = structuredClone(source);
const island = await createHeadlessIsland(baseline);
const { simulation } = island;
for (const _progress of simulation.prewarmCoastalGeometry()) { /* Derived caches only. */ }
const recorder = createBugReplayRecorder(simulation, "current-replay-restore");
await recorder.start(island.save);
let halfway: GameSaveV1 | undefined, halfwayIndex = 0, liveAfterHalfway: GameSaveV1 | undefined;
const half = Math.floor(updates.length / 2);
for (const [index, dt] of updates.entries()) {
  if (index === half) {
    halfway = await island.save(); halfwayIndex = index;
  }
  const started = performance.now();
  simulation.update(dt);
  recorder.advance(dt, performance.now() - started);
  if (index === half) liveAfterHalfway = await island.save();
}
const reproduction = recorder.report();
const live = reproduction.finalSettlement;
const replay = await runHeadlessReplay(reproduction, { hashEveryTicks: 0, mode: "runtime" });
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const pickActor = (value: unknown) => {
  const actor = value as Record<string, unknown>;
  return { uid: actor.uid, job: actor.job, phase: actor.phase, timer: actor.timer,
    x: actor.x, z: actor.z, visible: actor.visible, pathIndex: actor.pathIndex,
    pathLength: Array.isArray(actor.path) ? actor.path.length : undefined,
    stockContact: actor.stockContact, navigationRecovery: actor.navigationRecovery,
    workerMovementPlan: actor.workerMovementPlan, workerHandlingPlan: actor.workerHandlingPlan };
};

let restored: typeof replay.settlement | undefined;
let restoredHash: string | undefined;
let halfwayActor: unknown, restoredStartActor: unknown, restoredAfterOne: GameSaveV1 | undefined;
if (halfway) {
  halfwayActor = halfway.settlement.actors[2];
  const second = await createHeadlessIsland(structuredClone(halfway));
  restoredStartActor = second.simulation.saveState().actors[2];
  const remaining = updates.slice(halfwayIndex);
  if (remaining.length) {
    second.simulation.update(remaining[0]!);
    restoredAfterOne = await second.save();
  }
  for (const dt of remaining.slice(1)) second.simulation.update(dt);
  restored = second.simulation.saveState(); restoredHash = hash(restored);
}
const differences = (left: unknown, right: unknown, path = "", out: string[] = []): string[] => {
  if (out.length >= 24) return out;
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) {
    if (left !== right) out.push(`${path}: ${JSON.stringify(left)} vs ${JSON.stringify(right)}`);
    return out;
  }
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) differences((left as Record<string, unknown>)[key],
    (right as Record<string, unknown>)[key], `${path}.${key}`, out);
  return out;
};
const firstDifference = (left: unknown, right: unknown) => differences(left, right)[0];
const result = {
  file, seconds, baseline: { savedAt: baseline.savedAt, tick: baseline.settlement.gameTick,
    sha256: hash(baseline) }, updates: updates.length,
  freshReproduction: { finalHash: hash(live), finalSettlementHash: hash(reproduction.finalSettlement) },
  restoredReplay: { finalHash: replay.finalHash, endpointDifference: firstDifference(live, replay.settlement) },
  halfwayRestore: halfway && restored ? { atUpdate: halfwayIndex, finalHash: restoredHash,
    endpointDifference: firstDifference(live, restored), differences: differences(live, restored),
    firstTickDifference: liveAfterHalfway && restoredAfterOne
      ? differences(liveAfterHalfway.settlement, restoredAfterOne.settlement)[0] : null,
    firstTickDifferences: liveAfterHalfway && restoredAfterOne
      ? differences(liveAfterHalfway.settlement, restoredAfterOne.settlement).slice(0, 12) : null,
    halfwayActor: halfwayActor && pickActor(halfwayActor), restoredStartActor: restoredStartActor && pickActor(restoredStartActor) } : null,
  liveVsReplayEqual: isDeepStrictEqual(live, replay.settlement),
  liveVsHalfwayEqual: restored !== undefined && isDeepStrictEqual(live, restored),
  outcomeDifferences: replay.outcomeDifferences.length,
  limits: ["Current saves only; the old version-1 recording is intentionally refused by owner policy",
    "No browser/GPU scene; same-source headless runtime continuation"]
};
const output = resourcesPath("project-reviews", "follow-ups-2026-10-29");
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, "replay-restore-current.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
