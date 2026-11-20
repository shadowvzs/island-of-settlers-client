import { describe, expect, it } from "vitest";

import { BUILDING_LEVEL_STEPS } from "../src/shared/balance/building-levels";
import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { canStoreGoods, islandStorageCapacity, reserveStorageDispatch, storageDispatchLimit, storageRoom, withStorageCapacityPhase } from "../src/shared/settlement/storage-capacity";
import { cancelWorkshopUpgrade, finishWorkshopUpgrade, requestWorkshopUpgrade, updateWorkshopUpgrade, validWorkshopUpgrade } from "../src/shared/settlement/workshop-upgrades";
const storage = (typeId = 0, extra: Partial<SettlementBuilding> = {}) => ({
  uid: 1, typeId, construction: 1, inventory: {}, incoming: {}, input: {}, output: {}, ...extra
}) as SettlementBuilding;
const context = (...buildings: SettlementBuilding[]) => ({ buildings }) as SettlementContext;
describe("island-local pooled per-ware storage", () => {
  it("caps every completed Catapult delivery at its six-stone store including incoming reservations", () => {
    const source = storage(), destination = storage(16, { uid: 2, input: { stone: 3 }, incoming: { stone: 2 } });
    const island = context(source, destination);
    expect(storageDispatchLimit(island, source, destination, "stone", 8)).toBe(1);
    destination.incoming.stone = 3;
    expect(storageDispatchLimit(island, source, destination, "stone", 1)).toBe(0);
    expect(storageDispatchLimit(island, source, destination, "coins", 1)).toBe(0);
    expect(storageDispatchLimit(island, source, destination, "beer", 1)).toBe(0);
    destination.construction = .5;
    destination.required = { planks: 3, stone: 4 };
    expect(storageDispatchLimit(island, source, destination, "planks", 3)).toBe(3);
    destination.constructionConsumed = { planks: 1, stone: 2 };
    expect(storageDispatchLimit(island, source, destination, "planks", 3)).toBe(2);
    expect(storageDispatchLimit(island, source, destination, "stone", 8)).toBe(0);
    expect(storageDispatchLimit(island, source, destination, "beer", 1)).toBe(0);
  });

  it("counts completed friendly storage contributions only and keeps islands/wares independent", () => {
    const home = storage(0, { inventory: { stone: 1000, logs: 2 } });
    const store = storage(29), harbour = storage(39);
    const pool = islandStorageCapacity([home, store, harbour, storage(29, { construction: .9 }), storage(0, { militaryFaction: 1 })]);
    expect(pool.capacity).toBe(2000);
    expect(storageRoom(pool, "stone")).toBe(1000);
    expect(storageRoom(pool, "logs")).toBe(1998);
    expect(islandStorageCapacity([storage(29)]).capacity).toBe(500);
    expect(home.inventory.stone).toBe(1000);
  });
  it("reloads reservations, permits existing overflow after shrink and blocks new goods atomically", () => {
    const buildings = [storage(0, { inventory: { stone: 990 }, incoming: { stone: 20 } })];
    const restored = structuredClone(buildings);
    expect(storageRoom(islandStorageCapacity(restored), "stone")).toBe(0);
    expect(canStoreGoods(restored, { logs: 3, stone: 1 })).toBe(false);
    expect(restored[0]!.incoming.stone).toBe(20);
    restored[0]!.workshopUpgrade = { level: 1 };
    expect(storageRoom(islandStorageCapacity(restored), "stone")).toBe(1000 * BUILDING_LEVEL_STEPS.storage - 10);
    restored[0]!.workshopUpgrade = undefined;
    expect(restored[0]!.inventory.stone).toBe(990);
  });
  it("clips cart batches and prevents simultaneous output reservations exceeding remaining room", () => {
    const destination = storage(29, { inventory: { planks: 497 } }), source = storage(33);
    const island = context(destination, source);
    withStorageCapacityPhase(island, () => {
      expect(storageDispatchLimit(island, source, destination, "planks", 8)).toBe(3);
      reserveStorageDispatch(island, source, destination, "planks", 2);
      expect(storageDispatchLimit(island, source, destination, "planks", 8)).toBe(1);
      reserveStorageDispatch(island, source, destination, "planks", 1);
      expect(storageDispatchLimit(island, source, destination, "planks", 1)).toBe(0);
      expect(storageDispatchLimit(island, source, destination, "stone", 8)).toBe(8);
    });
  });
  it("allows net-neutral internal transfers even when the pool is already overflowing", () => {
    const source = storage(0, { inventory: { stone: 2000 } }), destination = storage(29);
    const island = context(source, destination);
    expect(storageDispatchLimit(island, source, destination, "stone", 8)).toBe(8);
  });
  it("escrows a storage's own materials and refunds them into inventory on cancellation", () => {
    const building = storage(0, { inventory: { hardwoodPlanks: 7, marble: 3 } });
    expect(requestWorkshopUpgrade(building)).toBe(true);
    expect(building.inventory).toEqual({ hardwoodPlanks: 3, marble: 1 });
    expect(building.workshopUpgrade?.reserved).toEqual({ hardwoodPlanks: 4, marble: 2 });
    expect(validWorkshopUpgrade(building)).toBe(true);
    expect(cancelWorkshopUpgrade(building)).toBe(true);
    updateWorkshopUpgrade(building);
    expect(building.inventory).toEqual({ hardwoodPlanks: 7, marble: 3 });
    expect(building.output).toEqual({});
    expect(building.workshopUpgrade).toBeUndefined();
    requestWorkshopUpgrade(building);
    expect(finishWorkshopUpgrade(building)).toBe(true);
    expect(islandStorageCapacity([building]).capacity).toBe(1000 * (1 + BUILDING_LEVEL_STEPS.storage));
    expect(validWorkshopUpgrade(building)).toBe(true);
  });
});
