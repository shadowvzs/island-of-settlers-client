import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { stageGameSession } from "../../src/app/settlement/game-session";
import type { OfflineEconomyMetrics } from "../../src/app/settlement/offline-economy";
import { advanceOfflineGame } from "../../src/app/settlement/offline-progress";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";

/** Read-only owner-save workload inventory. Raw saves and endpoints are never written by this tool. */
const [output, ...paths] = process.argv.slice(2);
if (!output || !paths.length) throw new Error("Usage: offline-owner-input-review.ts <report> <owner-save> [...]");
const rows = [];
for (const path of paths) {
  const bytes = await readFile(resolve(path)), hash = createHash("sha256").update(bytes).digest("hex");
  const source = JSON.parse(bytes.toString()) as GameSaveV1, before = JSON.stringify(source);
  const started = performance.now();
  try {
    const loaded = await stageGameSession(source), decodeMs = performance.now() - started;
    const metrics: OfflineEconomyMetrics[] = [], native: unknown[] = [], replayAt = performance.now();
    const result = await advanceOfflineGame(source, source.savedAt + 86_400_000, () => {}, {
      onEconomyMetrics: value => metrics.push(value), onIslandMetrics: value => native.push(value)
    });
    const replayMs = performance.now() - replayAt, stageAt = performance.now();
    await stageGameSession(result);
    assert.equal(native.length, 0); assert(metrics.length > 0);
    assert(metrics.every(entry => entry.calibrationSeconds === 0));
    assert.equal(JSON.stringify(source), before);
    assert.equal(createHash("sha256").update(await readFile(resolve(path))).digest("hex"), hash);
    rows.push({ path: resolve(path), sha256: hash, version: source.version, bytes: bytes.length,
      world: loaded.settlement.world, buildings: loaded.settlement.buildings.length,
      actors: loaded.settlement.actors.length, fields: loaded.settlement.fields.length,
      ships: loaded.settlement.naval.fleet.ships.length,
      decodeMs, replayMs, finalStageMs: performance.now() - stageAt,
      events: metrics.reduce((sum, entry) => sum + entry.events, 0),
      islands: metrics[0]!.islands, rssBytes: process.memoryUsage.rss(),
      nativeIslandMetrics: native.length, calibration: metrics.map(entry => entry.calibrationSeconds),
      inputUnchanged: true, strictStageValid: true });
  } catch (error) {
    rows.push({ path: resolve(path), sha256: hash, version: source.version,
      error: error instanceof Error ? error.message : String(error), elapsedMs: performance.now() - started });
  }
  await writeFile(resolve(output), JSON.stringify({ generatedAt: new Date().toISOString(), rows,
    scope: "Actual owner inputs read unchanged. Only hashes, counts and bounded CPU timings retained; raw input/player data and endpoints are not copied. Production fast-only zero-prefix; no native reference replay." }, null, 2));
  console.log(JSON.stringify(rows.at(-1)));
}
