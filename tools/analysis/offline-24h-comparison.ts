import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { stageGameSession } from "../../src/app/settlement/game-session";
import type { OfflineEconomyMetrics } from "../../src/app/settlement/offline-economy";
import { advanceOfflineGame } from "../../src/app/settlement/offline-progress";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import type { Goods } from "../../src/shared/settlement/settlement-types";
import {
  type BuildingProduction,
  groupMetalworksProduction, metalworksToolWares, offlineProductionIslands, offlineProductionSchema} from "./offline-production-comparison";

/**
 * Compare a completed exact 24 h reference with a fresh fast candidate from the same version-2
 * source. The exact file is produced by `exact-24h-reference.ts`; this tool never runs the exact
 * lane again, so the comparison can be repeated cheaply after a fast-model change.
 *
 * Usage from island-of-settlers-client/:
 *   npx tsx tools/analysis/offline-24h-comparison.ts <source-save> <exact-24h-reference> <output-directory>
 */
const sourcePath = resolve(process.argv[2] ?? "");
const exactPath = resolve(process.argv[3] ?? "");
const output = resolve(process.argv[4] ?? "../resources/offline-economy/current-v2-2026-10-29");
if (!process.argv[2] || !process.argv[3]) throw new Error("Supply the source save and exact 24 h reference");
const source = JSON.parse(await readFile(sourcePath, "utf8")) as GameSaveV1;
const exact = JSON.parse(await readFile(exactPath, "utf8")) as {
  seconds: number; outputs: Goods; inputs?: Goods; buildingProduction: BuildingProduction[];
};
if (!Number.isSafeInteger(exact.seconds) || exact.seconds <= 0) throw new Error("Invalid exact horizon");
const add = (goods: Goods, incoming: Readonly<Goods>) => {
  for (const [ware, count] of Object.entries(incoming)) if (!ware.startsWith("~"))
    goods[ware] = (goods[ware] ?? 0) + count;
};
const produced: Goods = {}, consumed: Goods = {};
const byIsland: Record<string, Goods> = {};
const buildingProduction = new Map<string, BuildingProduction>();
const recordBuilding = (entry: BuildingProduction) => {
  const key = `${entry.islandId}:${entry.uid}`;
  const previous = buildingProduction.get(key) ?? { ...entry, produced: {} };
  add(previous.produced, entry.produced);
  buildingProduction.set(key, previous);
};
const metrics: OfflineEconomyMetrics[] = [];
const started = performance.now();
const fast = await advanceOfflineGame(structuredClone(source), source.savedAt + exact.seconds * 1000,
  () => {}, {
    economy: true,
    onProduced: (_island, ware) => { if (!ware.startsWith("~")) produced[ware] = (produced[ware] ?? 0) + 1; },
    onProductionCycle: (island, building, _consumed, ware) => {
      if (!ware) return;
      const id = String(island ?? "home");
      byIsland[id] ??= {};
      byIsland[id]![ware] = (byIsland[id]![ware] ?? 0) + 1;
      recordBuilding({ islandId: id, uid: building.uid, typeId: building.typeId, produced: { [ware]: 1 } });
    },
    onEconomyMetrics: entry => metrics.push(entry)
  });
const wallMs = performance.now() - started;
for (const entry of metrics) for (const island of entry.production) {
  add(produced, island.produced);
  add(consumed, island.consumed);
  const id = island.islandId;
  byIsland[id] ??= {};
  add(byIsland[id]!, island.produced);
}
for (const entry of metrics) for (const building of entry.buildingProduction ?? []) recordBuilding(building);
await stageGameSession(fast);
const schema = offlineProductionSchema(offlineProductionIslands(source).values());
const exactGrouped = groupMetalworksProduction(exact.outputs, exact.buildingProduction,
  metalworksToolWares, schema.otherOutputs);
const fastGrouped = groupMetalworksProduction(produced, [...buildingProduction.values()],
  metalworksToolWares, schema.otherOutputs);
const wares = [...new Set([...Object.keys(exactGrouped), ...Object.keys(fastGrouped)])].sort();
const rows = wares.map(ware => {
  const expected = exactGrouped[ware] ?? 0, actual = fastGrouped[ware] ?? 0;
  const minimum = Math.ceil(.6 * expected), maximum = Math.floor(1.1 * expected);
  return { ware, exact: expected, fast: actual, minimum, maximum,
    difference: actual - expected, percent: expected ? 100 * (actual - expected) / expected : null,
    pass: actual >= minimum && actual <= maximum };
});
const report = {
  sourcePath, exactPath, seconds: exact.seconds, fastWallMs: wallMs,
  exactOutputs: exactGrouped, fastOutputs: fastGrouped,
  exactConsumed: exact.inputs, fastConsumed: consumed,
  fastByIsland: byIsland, rows,
  activeRows: rows.filter(row => row.exact > 0 || row.fast > 0).length,
  passedActiveRows: rows.filter(row => (row.exact > 0 || row.fast > 0) && row.pass).length,
  absoluteError: rows.reduce((sum, row) => sum + Math.abs(row.difference), 0),
  exactTotal: rows.reduce((sum, row) => sum + row.exact, 0),
  allPass: rows.every(row => row.pass),
  limitations: [
    "Fast replay is the current approximate model; exact is the fixed-tick authority.",
    "Production rows use completed cycles only; actor cargo and pending work remain in the save.",
    "This comparison does not establish rendering, browser or multi-island scale acceptance."
  ]
};
await writeFile(resolve(output, "offline-24h-comparison.json"), JSON.stringify(report, null, 2) + "\n");
await writeFile(resolve(output, "fast-24h-final.json"), JSON.stringify(fast, null, 2) + "\n");
console.error(JSON.stringify({ seconds: exact.seconds, wallMs, activeRows: report.activeRows,
  passedActiveRows: report.passedActiveRows, absoluteError: report.absoluteError, exactTotal: report.exactTotal,
  allPass: report.allPass }));
