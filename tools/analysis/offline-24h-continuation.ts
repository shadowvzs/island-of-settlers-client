import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { stageGameSession } from "../../src/app/settlement/game-session";
import { advanceOfflineGame } from "../../src/app/settlement/offline-progress";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";

const sourcePath = resolve(process.argv[2]!);
const outputPath = resolve(process.argv[3]!);
const source = JSON.parse(await readFile(sourcePath, "utf8")) as GameSaveV1;
const loaded = await stageGameSession(source);
const started = performance.now();
const resumed = await advanceOfflineGame(structuredClone(source), source.savedAt + 60_000,
  () => {}, { exact: true, eventCore: false });
const exactMs = performance.now() - started;
const resumedLoaded = await stageGameSession(resumed);
const stock = (save: GameSaveV1) => {
  const total: Record<string, number> = {};
  const add = (ware: string, count: number) => { total[ware] = (total[ware] ?? 0) + count; };
  for (const building of save.settlement.buildings)
    for (const goods of [building.inventory, building.input, building.output])
      for (const [ware, count] of Object.entries(goods)) if (count > 0) add(ware, count);
  for (const pool of save.settlement.storagePools.pools)
    for (const [ware, count] of Object.entries(pool.available)) if (count > 0) add(ware, count);
  for (const actor of save.settlement.actors) if (actor.ware) add(actor.ware, actor.wareUnits ?? 1);
  return total;
};
const report = {
  sourcePath,
  sourceSavedAt: source.savedAt,
  sourceActors: loaded.settlement.actors.length,
  sourceBuildings: loaded.settlement.buildings.length,
  resumedSavedAt: resumed.savedAt,
  resumedActors: resumedLoaded.settlement.actors.length,
  resumedBuildings: resumedLoaded.settlement.buildings.length,
  exactContinuationMs: Math.round(exactMs),
  sourceStock: stock(source),
  resumedStock: stock(resumed),
  limitations: [
    "Exact 60 s native continuation from the fast 24 h endpoint; no 24 h exact production reference.",
    "No browser/native rendering or user interaction.",
    "Stock comparison is physical building/pool/cargo stock, not in-flight reservations or paid work."
  ]
};
await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
