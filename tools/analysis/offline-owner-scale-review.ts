import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { stageGameSession } from "../../src/app/settlement/game-session";
import type { OfflineEconomyMetrics } from "../../src/app/settlement/offline-economy";
import { advanceOfflineGame } from "../../src/app/settlement/offline-progress";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { STORAGE_IDS } from "../../src/shared/settlement/production-rules";
import type { Goods } from "../../src/shared/settlement/settlement-types";

const paths = process.argv.slice(2).filter(argument => argument !== "--independent-stress");
const input = resolve(paths[0] ?? "../resources/project-reviews/offline-owner-scale-2026-11-05/fixture.json");
const output = resolve(paths[1] ?? resolve(dirname(input), "node-review.json"));
const bytes = await readFile(input), source = JSON.parse(bytes.toString()) as GameSaveV1;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const original = hash(JSON.stringify(source));
const islands = (save: GameSaveV1) => {
  const rows = new Map<string, GameSaveV1>([[String(save.archipelago?.active ?? "home"), save]]);
  if (save.archipelago?.home) rows.set("home", save.archipelago.home);
  for (const row of [...save.archipelago?.colonies ?? [], ...save.archipelago?.adventures ?? []])
    if (row.save && row.expeditionId !== save.archipelago?.active) rows.set(String(row.expeditionId), row.save);
  return rows;
};
const holdings = (save: GameSaveV1) => {
  const total: Goods = {};
  const add = (stock: Readonly<Goods>) => {
    for (const [ware, count] of Object.entries(stock)) total[ware] = (total[ware] ?? 0) + count;
  };
  const state = save.settlement;
  for (const pool of state.storagePools.pools) add(pool.available);
  for (const building of state.buildings) {
    add(building.inventory); add(building.input); add(building.output); add(building.shipReserve ?? {});
  }
  for (const actor of state.actors) {
    if (actor.ware) add({ [actor.ware]: actor.wareUnits ?? 1 });
    else if (actor.delivery && !actor.delivery.reserved && state.buildings.some(building =>
      building.uid === actor.delivery!.source && STORAGE_IDS.has(building.typeId)))
      add({ [actor.delivery.ware]: actor.wareUnits ?? 1 });
    else if (actor.productionOutput) add(actor.consumed ?? {});
    if (actor.handcart?.trip?.ware && actor.handcart.cargo) add({ [actor.handcart.trip.ware]: actor.handcart.cargo });
    if (actor.handcart?.trip?.ware && actor.handcart.trip.prepaid)
      add({ [actor.handcart.trip.ware]: actor.handcart.trip.prepaid });
  }
  for (const ship of state.naval.fleet.ships) add(ship.cargo);
  for (const escrow of state.trade?.escrow ?? []) {
    add(escrow.staged);
    for (const held of escrow.held) add(held.goods);
  }
  return total;
};
const before = islands(source), runs = [];
assert.equal(before.size, 5); assert.equal(source.archipelago?.colonies.length, 3);
const ownedArrivals = [...before].flatMap(([islandId, save]) => save.settlement.naval.fleet.ships
  .filter(ship => ship.visitor && !ship.visitor.leaving && Object.values(ship.cargo).some(count => count > 0))
  .map(ship => ({ islandId, ship })));
for (const seconds of [.05, 86_400]) {
  const metrics: OfflineEconomyMetrics[] = [], native: unknown[] = [];
  const started = performance.now();
  const result = await advanceOfflineGame(source, source.savedAt + seconds * 1000, () => {}, {
    onEconomyMetrics: value => metrics.push(value), onIslandMetrics: value => native.push(value)
  });
  const replayMs = performance.now() - started, stageAt = performance.now();
  assert.equal(metrics.length, 1); assert.equal(native.length, 0); assert.equal(metrics[0]!.calibrationSeconds, 0);
  const after = islands(result), ledger = metrics[0]!.production;
  assert.equal(after.size, 5); assert.equal(ledger.length, 5);
  const discrepancies: unknown[] = [], sent: Goods = {}, received: Goods = {};
  for (const entry of ledger) {
    const old = holdings(before.get(entry.islandId)!), current = holdings(after.get(entry.islandId)!);
    for (const ware of new Set([...Object.keys(old), ...Object.keys(current), ...Object.keys(entry.produced),
      ...Object.keys(entry.consumed), ...Object.keys(entry.sent), ...Object.keys(entry.received)])) {
      if (ware.startsWith("~")) continue;
      const physical = (current[ware] ?? 0) - (old[ware] ?? 0);
      const expected = (entry.produced[ware] ?? 0) - (entry.consumed[ware] ?? 0) +
        (entry.received[ware] ?? 0) - (entry.sent[ware] ?? 0);
      if (physical !== expected) discrepancies.push({ island: entry.islandId, ware, physical, expected });
    }
    for (const [ware, count] of Object.entries(entry.sent)) sent[ware] = (sent[ware] ?? 0) + count;
    for (const [ware, count] of Object.entries(entry.received)) received[ware] = (received[ware] ?? 0) + count;
  }
  if (discrepancies.length) await writeFile(resolve(dirname(output), "failed-ledger.json"),
    JSON.stringify({ seconds, discrepancies, source, result, ledger }));
  assert.deepEqual(discrepancies, [], `Physical goods do not reconcile at ${seconds}s`);
  for (const ware of new Set([...Object.keys(sent), ...Object.keys(received)]))
    assert.equal(sent[ware] ?? 0, received[ware] ?? 0, `Unmatched cross-island cargo ${ware}`);
  for (const save of after.values()) {
    assert.equal(save.savedAt, source.savedAt + seconds * 1000);
    await stageGameSession(JSON.parse(JSON.stringify(save)) as GameSaveV1);
  }
  if (seconds === .05) {
    for (const [id, save] of before) for (const actor of save.settlement.actors) {
      if (!actor.productionOutput || actor.productionSeconds === undefined ||
        !save.settlement.buildings.some(building => building.uid === actor.building && building.typeId === 24)) continue;
      assert.deepEqual(after.get(id)!.settlement.actors.find(candidate => candidate.uid === actor.uid), actor,
        "Short recovery must retain the original paid Armory worker and consumed inputs");
    }
    for (const { islandId, ship } of ownedArrivals)
      assert.deepEqual(after.get(islandId)!.settlement.naval.fleet.ships.find(current =>
        current.id === ship.id)?.cargo, ship.cargo);
    assert.equal(Object.values(sent).reduce((sum, count) => sum + count, 0), 0);
  } else {
    for (const { islandId, ship } of ownedArrivals)
      assert.equal(after.get(islandId)!.settlement.naval.fleet.ships.some(current => current.id === ship.id), false);
    assert(Object.values(sent).reduce((sum, count) => sum + count, 0) > 0, "Fixture never exercised coupled shipments");
    await writeFile(resolve(dirname(output), "fast-24h-final.json"), JSON.stringify(result));
    assert.equal(await advanceOfflineGame(result, result.savedAt), result);
  }
  runs.push({ seconds, replayMs, stageAllIslandsMs: performance.now() - stageAt,
    nativeIslandMetrics: native.length, calibrationSeconds: metrics[0]!.calibrationSeconds,
    events: metrics[0]!.events, allFiveStagesValid: true, perIslandGoodsReconciled: true,
    sent, received, causalOwnedCargo: true, ownedArrivalShips: ownedArrivals.length,
    ownedArrivalUnits: ownedArrivals.reduce((sum, entry) => sum +
      Object.values(entry.ship.cargo).reduce((units, count) => units + count, 0), 0), production: ledger,
    approximations: metrics[0]!.approximations });
}
assert.equal(hash(JSON.stringify(source)), original); assert.equal(hash(await readFile(input)), hash(bytes));
let independentStress;
if (process.argv.includes("--independent-stress")) {
  const independent = structuredClone(source);
  delete independent.archipelago;
  const started = performance.now(), copies = [];
  for (let index = 0; index < 7; index++) {
    const native: unknown[] = [], metrics: OfflineEconomyMetrics[] = [], at = performance.now();
    const result = await advanceOfflineGame(independent, independent.savedAt + 86_400_000, () => {}, {
      onEconomyMetrics: value => metrics.push(value), onIslandMetrics: value => native.push(value)
    });
    await stageGameSession(result);
    assert.equal(native.length, 0); assert.equal(metrics.length, 1);
    assert.equal(metrics[0]!.calibrationSeconds, 0); assert.equal(result.archipelago, undefined);
    copies.push({ index, replayAndStageMs: performance.now() - at, events: metrics[0]!.events,
      rssBytes: process.memoryUsage.rss(), cursorCorrect: result.savedAt === independent.savedAt + 86_400_000 });
  }
  independentStress = { copies, totalMs: performance.now() - started,
    scope: "Seven sequential independent clones of the retained 256-square developed home, warm Node process. CPU stress only; not coupled trade, seven colonies or seven supplied heavy owner saves." };
}
const report = { generatedAt: new Date().toISOString(), source: input, sha256: hash(bytes), runs,
  sourceObjectAndFileUnchanged: true, independentStress,
  scope: "Detached Node, supported legal five-island group; cutoff/finite-owned-cargo and per-island conservation. Excludes browser workers, UI/GPU, startup and network; not exact production accuracy." };
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, independentStress,
  runs: runs.map(({ approximations: _notes, production: _ledger, ...run }) => run) }));
