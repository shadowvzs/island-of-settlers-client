import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { stageGameSession } from "../../src/app/settlement/game-session";
import { advanceOfflineGame } from "../../src/app/settlement/offline-progress";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import type { Goods } from "../../src/shared/settlement/settlement-types";

/**
 * Exact fixed-tick 24 h reference. Unlike the production review this intentionally runs only the
 * authoritative lane and writes the final save plus production receipt for later fast comparisons.
 *
 * Usage from island-of-settlers-client/:
 *   npx tsx tools/analysis/exact-24h-reference.ts <source-save> <output-directory> [seconds]
 */
const sourcePath = resolve(process.argv[2] ?? "");
const output = resolve(process.argv[3] ?? "../resources/offline-economy/current-v2-2026-10-29");
const seconds = Number(process.argv[4] ?? process.env.SECONDS ?? 86_400);
if (!process.argv[2] || !Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 86_400)
  throw new Error("Supply a source save and a whole-number duration up to 86400 seconds");

const source = JSON.parse(await readFile(sourcePath, "utf8")) as GameSaveV1;
const add = (goods: Goods, ware: string, amount = 1) => {
  goods[ware] = (goods[ware] ?? 0) + amount;
};
const stock = (save: GameSaveV1) => {
  const storage: Goods = {}, input: Goods = {}, outputGoods: Goods = {}, shipReserves: Goods = {};
  for (const building of save.settlement.buildings) {
    if (building.militaryFaction) continue;
    for (const [ware, count] of Object.entries(building.inventory)) add(storage, ware, count);
    for (const [ware, count] of Object.entries(building.input)) add(input, ware, count);
    for (const [ware, count] of Object.entries(building.output)) add(outputGoods, ware, count);
    for (const [ware, count] of Object.entries(building.shipReserve ?? {})) add(shipReserves, ware, count);
  }
  return { storage, input, output: outputGoods, shipReserves,
    note: "Disjoint building stocks only; actor cargo, paid work and transit escrow are separate owners." };
};

const outputs: Goods = {}, inputs: Goods = {}, byBuilding: Record<number, Goods> = {};
const buildingProduction = new Map<string, { islandId: string; uid: number; typeId: number;
  produced: Goods }>();
let lastLog = performance.now();
const started = performance.now();
console.error(`Starting exact ${seconds}s reference from ${sourcePath}`);
const exact = await advanceOfflineGame(source, source.savedAt + seconds * 1000, progress => {
  if (performance.now() - lastLog >= 15_000) {
    console.error(`Exact ${progress.completedSeconds.toFixed(0)}/${progress.totalSeconds}s`);
    lastLog = performance.now();
  }
}, {
  exact: true,
  eventCore: false,
  onProductionCycle: (island, building, consumed, ware) => {
    if (ware) {
      add(outputs, ware);
      add(byBuilding[building.uid] ??= {}, ware);
      const key = `${island ?? "home"}:${building.uid}`;
      const entry = buildingProduction.get(key) ?? { islandId: String(island ?? "home"),
        uid: building.uid, typeId: building.typeId, produced: {} };
      add(entry.produced, ware);
      buildingProduction.set(key, entry);
    }
    for (const [input, count] of Object.entries(consumed)) add(inputs, input, count);
  }
});
const wallMs = performance.now() - started;
await stageGameSession(exact);
const reference = {
  inputPath: sourcePath,
  inputSavedAt: source.savedAt,
  seconds,
  wallMs,
  outputs,
  inputs,
  byBuilding,
  buildingProduction: [...buildingProduction.values()],
  finalStock: stock(exact),
  savedAt: exact.savedAt,
  limitations: ["Exact fixed-tick reference; no browser/UI/GPU cost.",
    "Production totals include completed cycles only; pending work and actor cargo remain in the final save."]
};
await writeFile(resolve(output, "exact-24h-reference.json"), JSON.stringify(reference, null, 2) + "\n");
await writeFile(resolve(output, "exact-24h-final.json"), JSON.stringify(exact, null, 2) + "\n");
console.error(`Exact ${seconds}s completed in ${Math.round(wallMs)}ms; final save validates`);
