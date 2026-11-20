import { expect, it, vi } from "vitest";

import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { recoverDemolitionStock } from "../src/shared/settlement/settlement-demolition-storage";
import { SETTLEMENT_SAVE_VERSION } from "../src/shared/settlement/settlement-save-state";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { createSimulationPlacement } from "../src/shared/settlement/settlement-simulation-placement";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import {
  changeStorageAvailable, creditStorageAt, reconcileStorageAccess, storagePoolAt, storageSnapshot, strandLocalEquipment,
  validStoragePools
} from "../src/shared/settlement/shared-storage";
import { setStorageCollect, storageCollect } from "../src/shared/settlement/shared-storage-collect";
import { BLOCKING, BUILD, type WorldData } from "../src/shared/world/world-data";

const storage = (uid: number, x: number, inventory: Record<string, number>) => ({
  uid, x, z: 1, access: { x, z: 1 }, workerApproach: { x, z: 1 },
  doorThreshold: { x, z: 1 }, typeId: uid === 0 ? 0 : 29, construction: 1,
  inventory, incoming: {}, input: {}, output: {}, shipReserve: {}
}) as unknown as SettlementBuilding;

const fixture = () => {
  const world = { cellsX: 7, cellsZ: 3, blocking: new Uint8Array(21), terrainRevision: 0
  } as unknown as WorldData;
  for (let z = 0; z < 3; z++) world.blocking[z * 7 + 4] = BLOCKING.water;
  const first = storage(0, 1, { logs: 7, boat: 1 });
  const second = storage(1, 2, { logs: 3, boat: 2 });
  const overseas = storage(2, 5, { logs: 11 });
  const context = { options: { world }, buildings: [first, second, overseas], actors: []
  } as unknown as SettlementContext;
  reconcileStorageAccess(context);
  return { context, first, overseas, second };
};

it("shares one spendable balance on a landmass, keeps equipment local, and excludes the other island", () => {
  const { context, first, overseas, second } = fixture();
  expect(first.storagePoolId).toBe(second.storagePoolId);
  expect(overseas.storagePoolId).not.toBe(first.storagePoolId);
  expect(first.inventory.logs).toBe(10);
  expect(second.inventory.logs).toBe(10);
  expect(first.inventory.boat).toBe(1);
  expect(second.inventory.boat).toBe(2);
  expect(changeStorageAvailable(context, second, "logs", -4)).toBe(true);
  expect(first.inventory.logs).toBe(6);
  expect(overseas.inventory.logs).toBe(11);
  expect(changeStorageAvailable(context, second, "logs", -7)).toBe(false);
  expect(changeStorageAvailable(context, second, "logs", Number.MAX_SAFE_INTEGER)).toBe(false);
  expect(storageSnapshot(context, first)?.available.logs).toBe(6);
  expect(storagePoolAt(context, first)?.id).toBe(first.storagePoolId);
});

it("serializes pooled goods once and validates the saved local equipment rows", () => {
  const { context, first, second } = fixture();
  const saved = JSON.parse(JSON.stringify({ buildings: context.buildings, storagePools: context.storagePools })) as {
    buildings: SettlementBuilding[]; storagePools: NonNullable<SettlementContext["storagePools"]>;
  };
  expect(saved.buildings[0]!.inventory).toEqual({ boat: 1 });
  expect(saved.buildings[1]!.inventory).toEqual({ boat: 2 });
  expect(saved.storagePools.pools.find(pool => pool.id === first.storagePoolId)?.available.logs).toBe(10);
  expect(validStoragePools(context, saved.storagePools, saved.buildings)).toBe(true);
  saved.buildings[0]!.inventory.logs = 10;
  expect(validStoragePools(context, saved.storagePools, saved.buildings)).toBe(false);
  delete saved.buildings[0]!.inventory.logs;
  saved.storagePools.pools[0]!.available = [] as unknown as Record<string, number>;
  expect(validStoragePools(context, saved.storagePools, saved.buildings)).toBe(false);
  expect(second.inventory.logs).toBe(10);
});

it("restores the same spendable balance after a real simulation save and load", () => {
  const cells = 32;
  const world = { seed: 7, cellsX: cells, cellsZ: cells, seaLevel: -1, start: { x: 8, z: 8 },
    heights: new Float32Array((cells + 1) ** 2), blocking: new Uint8Array(cells ** 2),
    walkCost: new Uint8Array(cells ** 2).fill(10), buildClass: new Uint8Array(cells ** 2).fill(BUILD.large),
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array() }
  } as unknown as WorldData;
  const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world),
    initialStock: { logs: 13, boat: 1 }, resourceTargets: () => [] });
  expect(simulation.storageSnapshot(simulation.headquarters.uid)?.available.logs).toBe(13);
  const saved = simulation.saveState();
  // The save writes the current settlement rules version (8 since A14-1, FORMATS.settlement).
  expect(saved.version).toBe(SETTLEMENT_SAVE_VERSION);
  expect(saved.buildings[0]!.inventory.logs).toBeUndefined();
  expect(saved.storagePools.pools[0]!.available.logs).toBe(13);
  simulation.headquarters.inventory.logs = 4;
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  expect(simulation.headquarters.inventory.logs).toBe(13);
  expect(simulation.storageSnapshot(simulation.headquarters.uid)?.available.logs).toBe(13);
});

it("keeps local equipment stranded on forced loss and restores it only to a new local access", () => {
  const { context, overseas, second } = fixture();
  context.buildings.splice(0, 2);
  expect(strandLocalEquipment(context, second, 1)).toBe(true);
  expect(context.storagePools?.stranded?.[0]?.goods.boat).toBe(1);
  const malformed = structuredClone(context.storagePools!);
  malformed.stranded![0]!.goods = [] as unknown as Record<string, number>;
  expect(validStoragePools(context, malformed, context.buildings.map(building => ({ ...building,
    inventory: JSON.parse(JSON.stringify(building.inventory)) as Record<string, number> })))).toBe(false);
  reconcileStorageAccess(context);
  expect(overseas.inventory.boat).toBeUndefined();
  const replacement = storage(3, 3, {});
  context.buildings.push(replacement);
  reconcileStorageAccess(context);
  expect(replacement.inventory.boat).toBe(1);
  expect(context.storagePools?.stranded).toEqual([]);
});

it("keeps private material salvaged on a landmass with no surviving storage access", () => {
  const { context, first, overseas, second } = fixture();
  context.buildings.splice(0, 2);
  context.storagePools!.pools = context.storagePools!.pools.filter(pool => pool.id !== first.storagePoolId);
  expect(creditStorageAt(context, second.access, "logs", 5)).toBe(true);
  expect(storagePoolAt(context, second.access)?.available.logs).toBe(5);
  expect(overseas.inventory.logs).toBe(11);
  const replacement = storage(4, 3, {});
  context.buildings.push(replacement);
  reconcileStorageAccess(context);
  expect(replacement.inventory.logs).toBe(5);
});

it("salvages only idle boats when another local depot survives demolition", () => {
  const { context, first, second } = fixture();
  context.naval = { expeditionDemand: () => ({}), localBoatClaims: () => 1 };
  recoverDemolitionStock(context, second, first);
  expect(first.inventory.boat).toBe(2);
  expect(second.inventory.boat).toBe(1);
  expect(first.inventory.logs).toBe(10);
});

it("counts every prepaid carrier unit as physically held until pickup", () => {
  const { context, first } = fixture();
  context.actors.push({ delivery: { source: first.uid, destination: 99, ware: "logs" },
    wareUnits: 4 } as SettlementActor);
  const snapshot = storageSnapshot(context, first)!;
  expect(snapshot.available.logs).toBe(10);
  expect(snapshot.held.logs).toBe(4);
  expect(snapshot.stored.logs).toBe(14);
});

it("allows one collecting island per ware and exposes it consistently through every local depot", () => {
  const { context, first, overseas, second } = fixture();
  second.typeId = 39;
  expect(storageCollect(context, first.uid).visible).toBe(false);
  overseas.typeId = 39;
  expect(storageCollect(context, first.uid).available).toBe(true);
  expect(setStorageCollect(context, first.uid, "logs", true)).toBe(true);
  expect(storageCollect(context, second.uid).wares).toEqual(["logs"]);
  expect(storageCollect(context, overseas.uid).unavailableWares).toEqual(["logs"]);
  expect(setStorageCollect(context, overseas.uid, "logs", true)).toBe(false);
  expect(setStorageCollect(context, overseas.uid, "stone", true)).toBe(true);
  const saved = JSON.parse(JSON.stringify({ buildings: context.buildings, pools: context.storagePools })) as {
    buildings: SettlementBuilding[]; pools: NonNullable<SettlementContext["storagePools"]>;
  };
  expect(validStoragePools(context, saved.pools, saved.buildings)).toBe(true);
  saved.pools.pools.find(pool => pool.id === overseas.storagePoolId)!.collect!.push("logs");
  expect(validStoragePools(context, saved.pools, saved.buildings)).toBe(false);
  expect(setStorageCollect(context, first.uid, "logs", false)).toBe(true);
  expect(setStorageCollect(context, overseas.uid, "logs", true)).toBe(true);
  overseas.typeId = 29;
  reconcileStorageAccess(context);
  expect(storageCollect(context, overseas.uid).wares).toEqual([]);
  expect(storageCollect(context, first.uid).unavailableWares).toEqual([]);
});

it("refuses last-access demolition before cancelling naval or military work", () => {
  const { context, overseas } = fixture();
  const remove = vi.fn();
  const systems = { naval: { canRemoveBuilding: () => true, removeBuilding: remove },
    military: { removeBuilding: remove }, tavern: { removeBuilding: remove } } as unknown as
    Parameters<typeof createSimulationPlacement>[1];
  const placement = createSimulationPlacement(context, systems);
  expect(placement.removeMilitarySite(overseas.uid, false).ok).toBe(false);
  expect(remove).not.toHaveBeenCalled();
});

it("writes a valid empty pool ledger for a building-free adventure", () => {
  const { context } = fixture();
  context.buildings = [];
  context.storagePools = undefined;
  reconcileStorageAccess(context);
  expect(context.storagePools).toEqual({ version: 1, nextId: 0, pools: [], stranded: [] });
  expect(validStoragePools(context, context.storagePools!, [])).toBe(true);
});

it("does not transfer the owner's pooled wares when one depot changes faction", () => {
  const { context, first, second } = fixture();
  second.militaryFaction = 1;
  reconcileStorageAccess(context);
  expect(second.storagePoolId).toBeUndefined();
  expect(second.inventory.logs).toBeUndefined();
  expect(second.inventory.boat).toBe(2);
  expect(first.inventory.logs).toBe(10);
});
