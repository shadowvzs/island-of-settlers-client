import { describe, expect, it } from "vitest";

import { colonyAdvancedCargo } from "../src/shared/settlement/colony-advanced-material-trade";
import { colonySupplyDemand, takeFromStorages } from "../src/shared/settlement/colony-economy";
import { colonyExpiryAssets, creditExpiredColony } from "../src/shared/settlement/colony-expiry-assets";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { shuttleNeeds } from "../src/shared/settlement/harbour-shuttle-demand";
import { advanceOfflineHarbourShuttles } from "../src/shared/settlement/harbour-shuttle-offline";
import type { ShuttleState } from "../src/shared/settlement/harbour-shuttle-plan";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { createShipSea } from "./helpers/ship-motion-scenarios";

const storage = (uid: number, pool: number, inventory: Record<string, number>, typeId = 39) =>
  ({ uid, typeId, construction: 1, storagePoolId: pool, inventory, input: {}, output: {},
    incoming: {}, required: {}, accepts: {}, colonyHome: uid === 1 }) as unknown as SettlementBuilding;

describe("shared storage naval and expiry custody", () => {
  it("counts a stock view once for colony demand/export and never borrows a second landmass pool", () => {
    const stock = { planks: 10, cedarPlanks: 9 };
    const a = storage(1, 0, stock), b = storage(2, 0, stock), overseas = storage(3, 1, { planks: 100, cedarPlanks: 100 });
    const site = { ...storage(4, 0, {}), typeId: 10, construction: 0, worker: 90,
      required: { planks: 12 } };
    expect(colonySupplyDemand([a, b, overseas, site]).planks).toBe(2);
    expect(colonyAdvancedCargo([a, b, overseas])).toEqual({ cedarPlanks: 9 });
    expect(takeFromStorages([a, b, overseas], { planks: 15 })).toEqual({ planks: 10 });
    expect(overseas.inventory.planks).toBe(100);
  });

  it("counts each free pool and private manifest once and credits only the actual saved home pool", () => {
    const a = storage(1, 0, { boat: 1 }, 0), b = storage(2, 0, {}), overseas = storage(3, 1, {});
    a.shipReserve = { logs: 3 };
    const game = { settlement: { buildings: [a, b, overseas], actors: [], settlers: 0,
      storagePools: { version: 1, nextId: 2, pools: [
        { id: 0, owner: 0, anchor: 0, available: { logs: 10 } },
        { id: 1, owner: 0, anchor: 99, available: { logs: 50 } }
      ] }, naval: { preparation: { preparations: [{ cargo: { stone: 2 } }] },
        fleet: { orders: [{ id: 1, cargo: { logs: 3 } }], ships: [],
          shuttles: { jobs: [{ cargo: { fish: 4 }, homeUid: 1, sourceUid: 1 }] } } } } } as unknown as GameSaveV1;
    expect(colonyExpiryAssets(game).cargo).toEqual({ boat: 1, logs: 63, stone: 2, fish: 4 });
    const before = JSON.stringify(game);
    const credited = creditExpiredColony(game, { cargo: { marble: 7, boat: 1 }, troops: [] });
    expect(credited.settlement.storagePools.pools[0]!.available.marble).toBe(7);
    expect(credited.settlement.storagePools.pools[1]!.available.marble).toBeUndefined();
    expect(credited.settlement.buildings[0]!.inventory.boat).toBe(2);
    expect(JSON.stringify(game)).toBe(before);
  });

  it("counts stranded idle equipment and an orphaned live boat as distinct physical receipts", () => {
    const game = { settlement: { buildings: [], actors: [], storagePools: { pools: [],
      stranded: [{ owner: 0, anchor: 10, goods: { boat: 2, horse: 1 } }] },
      naval: { fleet: { ships: [], orders: [], shuttles: { jobs: [
        { cargo: { fish: 3 }, homeUid: 99, sourceUid: 99 }
      ] } } } } } as unknown as GameSaveV1;
    expect(colonyExpiryAssets(game).cargo).toEqual({ boat: 3, horse: 1, fish: 3 });
  });

  it("does not create a water transfer between two accesses of one pool even without roads", () => {
    const sea = createShipSea(), from = sea.harbour(20), to = sea.harbour(44);
    from.storagePoolId = 0; to.storagePoolId = 0;
    from.inventory.stone = 8;
    sea.context.options.roads.route = () => null;
    sea.context.transfers = [{ id: 1, count: 4, source: from.uid, destination: to.uid, ware: "stone" }];
    expect(shuttleNeeds(sea.context, from, to, [])).toEqual([]);
  });

  it("deposits a saved offline boat cargo into its destination pool, preserving the local boat roster", () => {
    const a = storage(1, 0, { boat: 1 }), b = storage(2, 1, {});
    b.incoming.fish = 3;
    const settlement = { buildings: [a, b], settlers: 0, transfers: [], storagePools: {
      version: 1 as const, nextId: 2, pools: [{ id: 0, owner: 0, anchor: 0, available: {} },
        { id: 1, owner: 0, anchor: 10, available: {} as Record<string, number> }] } };
    const state = { jobs: [{ sourceUid: 1, destinationUid: 2, cargo: { fish: 3 }, crew: 1,
      phase: "unloading", timer: 0, plan: { returning: 1 } }], nextJob: 2 } as unknown as ShuttleState;
    advanceOfflineHarbourShuttles(state, settlement, 2);
    expect(settlement.storagePools.pools[1]!.available.fish).toBe(3);
    expect(b.inventory.fish).toBeUndefined();
    expect(a.inventory.boat).toBe(1);
  });
  it("hands an orphaned offline empty return to native recovery at its saved physical endpoint", () => {
    const destination = storage(2, 1, {}), hq = storage(9, 2, {}, 0);
    const settlement = { buildings: [destination, hq], settlers: 0, transfers: [], storagePools: {
      version: 1 as const, nextId: 3, pools: [{ id: 1, owner: 0, anchor: 10, available: {} },
        { id: 2, owner: 0, anchor: 20, available: {} }] } };
    const sourceLanding = { x: 1, z: 1 };
    const state = { jobs: [{ sourceUid: 1, homeUid: 1, homeLost: true, destinationUid: 2, cargo: {}, crew: 1,
      phase: "returning", timer: 0, sourceLanding, destinationLanding: { x: 10, z: 1 },
      plan: { returning: 1 } }], nextJob: 2 } as unknown as ShuttleState;
    advanceOfflineHarbourShuttles(state, settlement, 10);
    expect(state.jobs[0]).toMatchObject({ phase: "blocked", hold: sourceLanding, returningHome: true });
    expect(settlement.settlers).toBe(0);
    expect(destination.inventory.boat).toBeUndefined();
    expect(hq.inventory.boat).toBeUndefined();
  });

});
