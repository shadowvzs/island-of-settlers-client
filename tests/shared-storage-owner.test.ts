import { describe, expect, it } from "vitest";

import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import {
  changeStorageAvailable, reconcileStorageAccess, storageSnapshot, validStoragePools
} from "../src/shared/settlement/shared-storage";
import { storageDispatchLimit } from "../src/shared/settlement/storage-capacity";
import type { WorldData } from "../src/shared/world/world-data";
import { economyScenario } from "./helpers/economy-factions";

const ENEMY = 2;

const storage = (uid: number, x: number, inventory: Record<string, number>, militaryFaction?: number) => ({
  uid, x, z: 1, access: { x, z: 1 }, workerApproach: { x, z: 1 }, doorThreshold: { x, z: 1 }, typeId: 29,
  construction: 1, inventory, incoming: {}, input: {}, output: {}, shipReserve: {}, militaryFaction
}) as unknown as SettlementBuilding;

const island = (economyFactions?: readonly number[]) => {
  const world = { blocking: new Uint8Array(21), cellsX: 7, cellsZ: 3, scenario: economyScenario(economyFactions),
    terrainRevision: 0 } as unknown as WorldData;
  const player = storage(1, 1, { logs: 7 });
  const enemy = storage(2, 3, { logs: 5 }, ENEMY);
  const context = {
    actors: [], buildings: [player, enemy], options: { world },
    talents: { storageCapacity: 1 }
  } as unknown as SettlementContext;
  reconcileStorageAccess(context);
  return { context, enemy, player };
};

const savedPools = (context: SettlementContext) => JSON.parse(JSON.stringify({
  buildings: context.buildings, storagePools: context.storagePools
})) as { buildings: SettlementBuilding[]; storagePools: NonNullable<SettlementContext["storagePools"]> };

/** EAI1b step b5: a faction with an economy keeps its own pool on a shared landmass. */
describe("storage pools per owner", () => {
  it("leaves a hostile depot of a faction without an economy outside every pool, as before", () => {
    const { context, enemy, player } = island();
    expect(player.storagePoolId).toBeDefined();
    expect(enemy.storagePoolId).toBeUndefined();
    expect(context.storagePools?.pools.map(pool => pool.owner)).toEqual([0]);
  });

  it("gives an economy faction its own pool on the same land, with neutral talents", () => {
    const { context, enemy, player } = island([ENEMY]);
    expect(enemy.storagePoolId).toBeDefined();
    expect(enemy.storagePoolId).not.toBe(player.storagePoolId);
    expect(context.storagePools?.pools.map(pool => pool.owner).sort()).toEqual([0, ENEMY]);
    expect(changeStorageAvailable(context, enemy, "logs", -5)).toBe(true);
    expect(player.inventory.logs).toBe(7);
    const playerCapacity = storageSnapshot(context, player)!.capacity;
    const enemyCapacity = storageSnapshot(context, enemy)!.capacity;
    expect(playerCapacity).toBe(enemyCapacity * 2);
    expect(storageDispatchLimit(context, player, enemy, "logs", 10_000)).toBe(enemyCapacity);
  });

  it("accepts a saved pool of an economy faction and refuses it on an island without that economy", () => {
    const { context } = island([ENEMY]);
    const saved = savedPools(context);
    expect(validStoragePools(context, saved.storagePools, saved.buildings)).toBe(true);
    const playerOnly = island().context;
    expect(validStoragePools(playerOnly, saved.storagePools, saved.buildings)).toBe(false);
    saved.storagePools.pools[1]!.owner = -1;
    expect(validStoragePools(context, saved.storagePools, saved.buildings)).toBe(false);
  });
});
