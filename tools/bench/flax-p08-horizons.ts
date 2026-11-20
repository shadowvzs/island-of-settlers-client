import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { advanceOfflineGame } from "../../src/app/settlement/offline-progress";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { workshopUpgradeCost } from "../../src/shared/settlement/workshop-upgrades";
import { flaxOwned } from "./flax-p08-ledger";

/** Feature-only selected policy: short native boundary and30/60-minute economy after calibration. */
export const runFlaxP08Horizons = async (source: GameSaveV1, output: string) => {
  const loom = source.settlement.buildings.find(site => site.typeId === 61)!;
  const cost = workshopUpgradeCost(loom), reports = [];
  for (const seconds of [.05, 60, 1800, 3600]) {
    const next = await advanceOfflineGame(structuredClone(source), source.savedAt + seconds * 1000, () => {});
    const after = next.settlement.buildings.find(site => site.uid === loom.uid)!;
    const level = after.workshopUpgrade?.level ?? 0;
    assert.equal(level, seconds < 1 ? 0 : 1, "Pending paid upgrade uses its actual completion boundary");
    for (const [ware, amount] of Object.entries(cost))
      assert.equal(flaxOwned(source, ware) - flaxOwned(next, ware), level ? amount : 0, `Finite offline upgrade ${ware}`);
    assert.equal(new Set(next.settlement.naval.fleet.ships.map(ship => ship.id)).size, next.settlement.naval.fleet.ships.length);
    assert.equal(next.settlement.naval.fleet.ships.length, 0, "Paused yard stays paused across horizon");
    assert.equal(next.settlement.actors.length, new Set(next.settlement.actors.map(actor => actor.uid)).size);
    reports.push({ seconds, savedLevel: level, displayedLevel: level + 1, cost,
      cloth: flaxOwned(next, "cloth"), fields: next.settlement.fields.length,
      policy: seconds < 1800 ? "native" : "selected economy after native calibration" });
    writeFileSync(resolve(output, `horizon-${seconds}.json`), JSON.stringify(next));
  }
  return reports;
};
