import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { readCatchUpReplayOptions } from "../../../island-of-settlers-api/src/catch-up-replay";
import { fromSaveSnapshot, toSaveSnapshot } from "../../src/app/save-store/save-snapshot";
import { stageGameSession } from "../../src/app/settlement/game-session";
import { type OfflineEconomyMetrics } from "../../src/app/settlement/offline-economy";
import { advanceOfflineGame } from "../../src/app/settlement/offline-progress";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { STORAGE_IDS } from "../../src/shared/settlement/production-rules";

const [input, output, bundleRoot] = process.argv.slice(2);
if (!input || !output || !bundleRoot) throw new Error("Usage: offline-fast-startup-proof.ts <save> <report> <verifier-root>");
const bytes = await readFile(resolve(input)), source = JSON.parse(bytes.toString()) as GameSaveV1;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const sourceHash = hash(bytes), objectHash = hash(JSON.stringify(source));
const { sourceVersion } = JSON.parse(await readFile(resolve(bundleRoot, "latest.json"), "utf8")) as { sourceVersion: string };
if (!/^[a-f0-9]+$/.test(sourceVersion)) throw new Error("Invalid verifier source version");
const bundle = await import(pathToFileURL(resolve(bundleRoot, sourceVersion, "verifier.mjs")).href) as
  typeof import("../../src/app/settlement/server-bundle");
const goods = (save: GameSaveV1) => {
  const totals: Record<string, number> = {};
  const add = (stock: Readonly<Record<string, number>>) => {
    for (const [ware, count] of Object.entries(stock)) totals[ware] = (totals[ware] ?? 0) + count;
  };
  for (const pool of save.settlement.storagePools.pools) add(pool.available);
  for (const building of save.settlement.buildings) { add(building.inventory); add(building.input); add(building.output); }
  for (const actor of save.settlement.actors) {
    if (actor.ware) add({ [actor.ware]: actor.wareUnits ?? 1 });
    // Warehouse dispatch pays at assignment, before the courier visibly grips its cargo.
    // That prepaid receipt remains physical custody outside both free stock and actor.ware.
    else if (actor.delivery && !actor.delivery.reserved && save.settlement.buildings.some(building =>
      building.uid === actor.delivery!.source && STORAGE_IDS.has(building.typeId)))
      add({ [actor.delivery.ware]: actor.wareUnits ?? 1 });
    else if (actor.productionOutput) add(actor.consumed ?? {});
    if (actor.handcart?.trip?.ware && actor.handcart.cargo) add({ [actor.handcart.trip.ware]: actor.handcart.cargo });
  }
  for (const ship of save.settlement.naval.fleet.ships) add(ship.cargo ?? {});
  return totals;
};
const runs = [];
for (const seconds of [180, 60]) {
  const metrics: OfflineEconomyMetrics[] = [], native: unknown[] = [];
  const now = source.savedAt + seconds * 1000, started = performance.now();
  const result = await advanceOfflineGame(source, now, () => {}, {
    onEconomyMetrics: value => metrics.push(value), onIslandMetrics: value => native.push(value)
  });
  const replayMs = performance.now() - started, stageAt = performance.now();
  await stageGameSession(result); const stageMs = performance.now() - stageAt;
  assert.equal(native.length, 0); assert.equal(metrics.length, 1); assert.equal(metrics[0]!.calibrationSeconds, 0);
  assert.equal(result.savedAt, now);
  const forced = await advanceOfflineGame(source, now, () => {}, { economy: true, economyCalibrationSeconds: 0 });
  assert.deepEqual(result, forced);
  const serverAt = performance.now();
  const server = await bundle.catchUpSnapshot(toSaveSnapshot(source), now, readCatchUpReplayOptions({}));
  assert(server); assert(isDeepStrictEqual(server.snapshot, toSaveSnapshot(result)), "API bundle/client snapshot mismatch");
  const decoded = fromSaveSnapshot(server.snapshot); assert(decoded); await stageGameSession(decoded);
  const beforeGoods = goods(source), afterGoods = goods(result), ledger = metrics[0]!.production[0]!;
  for (const ware of new Set([...Object.keys(beforeGoods), ...Object.keys(afterGoods),
    ...Object.keys(ledger.produced), ...Object.keys(ledger.consumed)])) {
    if (ware.startsWith("~")) continue;
    assert.equal((afterGoods[ware] ?? 0) - (beforeGoods[ware] ?? 0),
      (ledger.produced[ware] ?? 0) - (ledger.consumed[ware] ?? 0) +
      (ledger.received[ware] ?? 0) - (ledger.sent[ware] ?? 0), `Unreconciled ware ${ware}`);
  }
  const actorIds = new Set(result.settlement.actors.map(actor => actor.uid));
  assert.equal(actorIds.size, result.settlement.actors.length);
  assert(source.settlement.actors.every(actor => actorIds.has(actor.uid)), "Original actor identity lost");
  const plausibility = await bundle.checkPlausibility({ before: toSaveSnapshot(source), after: server.snapshot,
    credits: {}, realSeconds: seconds });
  assert.deepEqual(plausibility.violations, [], "Fast result violates server production/resource budget");
  runs.push({ seconds, replayMs, stageMs, totalMs: replayMs + stageMs,
    serverMs: performance.now() - serverAt, calibrationSeconds: metrics[0]!.calibrationSeconds,
    nativeIslandMetrics: native.length, events: metrics[0]!.events, forcedZeroEqual: true, bundleEqual: true,
    actors: result.settlement.actors.length, buildings: result.settlement.buildings.length,
    goodsLedgerReconciled: true, originalActorIdsPreserved: true, serverBudgetViolations: plausibility.violations });
}
assert.equal(hash(await readFile(resolve(input))), sourceHash); assert.equal(hash(JSON.stringify(source)), objectHash);
await mkdir(dirname(resolve(output)), { recursive: true });
await writeFile(resolve(output), JSON.stringify({ sourceVersion, sourceHash, sourceFileUnchanged: true,
  sourceObjectUnchanged: true, productionOptions: readCatchUpReplayOptions({}), runs,
  scope: "Detached Node default replay and strict validation plus real built API verifier parity; not browser/UI/network latency." }, null, 2));
console.log(JSON.stringify({ sourceVersion, runs }));
