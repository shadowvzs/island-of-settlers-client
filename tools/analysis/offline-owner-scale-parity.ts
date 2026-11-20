import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { readCatchUpReplayOptions } from "../../../island-of-settlers-api/src/catch-up-replay";
import { fromSaveSnapshot, toSaveSnapshot } from "../../src/app/save-store/save-snapshot";
import { stageGameSession } from "../../src/app/settlement/game-session";
import type { OfflineEconomyMetrics } from "../../src/app/settlement/offline-economy";
import { advanceOfflineGame } from "../../src/app/settlement/offline-progress";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";

const [sourcePath, bundlePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !bundlePath || !outputPath)
  throw new Error("Usage: offline-owner-scale-parity.ts <coupled-save> <explicit-verifier.mjs> <report>");
const bytes = await readFile(resolve(sourcePath)), source = JSON.parse(bytes.toString()) as GameSaveV1;
const bundle = await import(pathToFileURL(resolve(bundlePath)).href) as typeof import("../../src/app/settlement/server-bundle");
const runs = [];
for (const seconds of [60, 86_400]) {
  const now = source.savedAt + seconds * 1_000, metrics: OfflineEconomyMetrics[] = [], native: unknown[] = [];
  const started = performance.now();
  const client = await advanceOfflineGame(source, now, () => {}, {
    onEconomyMetrics: value => metrics.push(value), onIslandMetrics: value => native.push(value)
  });
  const clientMs = performance.now() - started, serverAt = performance.now();
  const server = await bundle.catchUpSnapshot(toSaveSnapshot(source), now, readCatchUpReplayOptions({}));
  assert(server); assert.deepEqual(server.snapshot, toSaveSnapshot(client), "Complete client/API snapshot mismatch");
  const decoded = fromSaveSnapshot(server.snapshot); assert(decoded);
  const saves = [decoded, ...decoded.archipelago!.colonies.map(entry => entry.save!),
    ...decoded.archipelago!.adventures!.map(entry => entry.save!)];
  for (const save of saves) await stageGameSession(save);
  assert.equal(native.length, 0); assert.equal(metrics.length, 1); assert.equal(metrics[0]!.calibrationSeconds, 0);
  const plausibility = await bundle.checkPlausibility({ before: toSaveSnapshot(source), after: server.snapshot,
    credits: {}, realSeconds: seconds });
  assert.deepEqual(plausibility.violations, [], "Server resource/production budget violated");
  runs.push({ seconds, clientMs, serverAndStagingMs: performance.now() - serverAt,
    completeSnapshotEqual: true, strictStages: saves.length, nativeIslandMetrics: native.length,
    calibrationSeconds: metrics[0]!.calibrationSeconds, events: metrics[0]!.events,
    serverBudgetViolations: plausibility.violations });
}
assert.equal(createHash("sha256").update(await readFile(resolve(sourcePath))).digest("hex"),
  createHash("sha256").update(bytes).digest("hex"));
const report = { generatedAt: new Date().toISOString(), source: resolve(sourcePath),
  sourceSha256: createHash("sha256").update(bytes).digest("hex"), bundle: resolve(bundlePath),
  sourceVersion: dirname(resolve(bundlePath)).split("/").at(-1), runs,
  scope: "Explicit built API bundle matches complete default-client snapshots and validates all five islands at60s/24h. No database/network route exercised; no exact native replay or production-accuracy claim." };
await writeFile(resolve(outputPath), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
