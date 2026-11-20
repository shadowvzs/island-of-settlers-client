import { expect, it } from "vitest";

import { stageGameSession } from "../src/app/settlement/game-session";
import { applyOfflineEconomyStock, offlineEconomyStorage } from "../src/app/settlement/offline-economy";
import { advanceOfflineGame } from "../src/app/settlement/offline-progress";
import { offlineStorageCapacity } from "../src/app/settlement/offline-storage-capacity";
import { lateStockSave } from "./helpers/offline-measured-islands";

it("advances a generated v2 home save without duplicating pooled stock into building rows", async () => {
  const source = await lateStockSave();
  await expect(stageGameSession(source)).resolves.toBeDefined();
  const home = source.settlement.buildings.find(building => building.typeId === 0)!;
  const pool = source.settlement.storagePools.pools.find(entry => entry.id === home.storagePoolId)!;
  const before = offlineEconomyStorage(source).stock;
  expect(before.logs).toBe(pool.available.logs);
  expect(offlineStorageCapacity(source, [home]).stored.logs).toBe(pool.available.logs);
  expect(() => applyOfflineEconomyStock(source, before, { ...before, logs: before.logs! - 1,
    planks: 0, stone: -1 })).toThrow("unavailable stone");
  expect(pool.available.logs).toBe(before.logs);
  applyOfflineEconomyStock(source, before, { ...before, logs: before.logs! - 5 });
  expect(pool.available.logs).toBe(before.logs! - 5);
  expect(home.inventory.logs).toBeUndefined();
  const advanced = await advanceOfflineGame(source, source.savedAt + 120_000, () => {},
    { exact: true, eventCore: false });
  await expect(stageGameSession(advanced)).resolves.toBeDefined();
}, 25_000);

it("keeps storage-door receipts aligned after a bounded fast offline catch-up", async () => {
  const original = await lateStockSave();
  const source = await advanceOfflineGame(original, original.savedAt + 120_000, () => {},
    { exact: true, eventCore: false });
  const advanced = await advanceOfflineGame(source, source.savedAt + 30 * 60_000, () => {},
    { economy: true });
  const traffic = advanced.settlement.storageTraffic;
  const actors = new Map(advanced.settlement.actors.map(actor => [actor.uid, actor]));
  const mismatches = (traffic?.actors ?? []).filter(entry => {
    const actor = actors.get(entry.actor);
    return !actor || actor.phase !== entry.phase || actor.home !== entry.home;
  }).map(entry => ({ actor: entry.actor, phase: entry.phase, home: entry.home,
    actualPhase: actors.get(entry.actor)?.phase, actualHome: actors.get(entry.actor)?.home }));
  expect(mismatches).toEqual([]);
  await expect(stageGameSession(advanced)).resolves.toBeDefined();
}, 25_000);
