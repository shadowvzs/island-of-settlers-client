import { expect, it } from "vitest";

import { NEUTRAL_TALENT_MODIFIERS } from "../src/shared/progression/talents";
import {
  recoverDemolitionStock, releaseDemolishedSourcePrepayments, storageDemolitionReason
} from "../src/shared/settlement/settlement-demolition-storage";
import type {
  SettlementActor, SettlementBuilding, SettlementContext
} from "../src/shared/settlement/settlement-types";
import {
  changeStorageAvailable, reconcileStorageAccess, storageSnapshot
} from "../src/shared/settlement/shared-storage";
import {
  canStoreGoods, contextStorageCapacity, islandStorageCapacity, reserveStorageDispatch,
  storageDispatchLimit, withStorageCapacityPhase
} from "../src/shared/settlement/storage-capacity";
import { BLOCKING, type WorldData } from "../src/shared/world/world-data";

const fixture = () => {
  const world = { cellsX: 7, cellsZ: 3, blocking: new Uint8Array(21), terrainRevision: 0 } as unknown as WorldData;
  for (let z = 0; z < 3; z++) world.blocking[z * 7 + 4] = BLOCKING.water;
  const storage = (uid: number, x: number, logs: number) => ({ uid, typeId: uid === 0 ? 0 : 29,
    x, z: 1, access: { x, z: 1 }, construction: 1, inventory: { logs }, input: {}, output: {},
    incoming: {}, accepts: {}, shipReserve: {} }) as unknown as SettlementBuilding;
  const home = storage(0, 1, 7), local = storage(1, 2, 3), offshore = storage(2, 5, 11);
  const context = { options: { world }, buildings: [home, local, offshore], actors: [] } as unknown as SettlementContext;
  reconcileStorageAccess(context);
  return { context, home, local, offshore };
};

it("counts shared balances once, reserves only receiver-pool room and forbids same-pool positioning", () => {
  const { context, home, local, offshore } = fixture();
  const producer = { uid: 3, typeId: 33, construction: 1 } as SettlementBuilding;
  home.inventory.planks = 1498;
  local.incoming.planks = 1;
  expect(islandStorageCapacity(context.buildings).stored.logs).toBe(21);
  expect(contextStorageCapacity(context).capacity).toBe(1500);
  expect(contextStorageCapacity(context, offshore).capacity).toBe(500);
  expect(storageDispatchLimit(context, home, local, "logs", 1)).toBe(0);
  withStorageCapacityPhase(context, () => {
    expect(storageDispatchLimit(context, producer, local, "planks", 5)).toBe(1);
    local.incoming.planks = 2;
    reserveStorageDispatch(context, producer, local, "planks", 1);
    expect(storageDispatchLimit(context, producer, home, "planks", 1)).toBe(0);
    expect(storageDispatchLimit(context, producer, offshore, "planks", 900)).toBe(500);
  });
  expect(canStoreGoods(context.buildings, { planks: 1 })).toBe(false);
  expect(canStoreGoods(context.buildings, { planks: 500 }, 0, offshore)).toBe(true);
});

it("applies storage talents per local pool and never borrows another access's equipment capacity", () => {
  const { context, home, local, offshore } = fixture();
  context.talents = { ...NEUTRAL_TALENT_MODIFIERS, storageCapacity: .25 };
  expect(contextStorageCapacity(context, local).capacity).toBe(1875);
  expect(contextStorageCapacity(context, offshore).capacity).toBe(625);
  home.inventory.boat = 999;
  expect(canStoreGoods(context.buildings, { boat: 2 })).toBe(false);
  expect(canStoreGoods(context.buildings, { boat: 2 }, 0, local)).toBe(true);
});

it("retains forced-loss stock locally, refunds unpicked custody once and strands only idle boats", () => {
  const { context, home, offshore } = fixture();
  expect(storageDemolitionReason(context, offshore)).toMatch(/Empty the local storage pool/);
  expect(changeStorageAvailable(context, offshore, "logs", -3)).toBe(true);
  offshore.input.logs = 2;
  offshore.inventory.boat = 2;
  const actor = { uid: 4, home: 0, job: "Carrier", phase: "pickup", ware: null,
    delivery: { source: offshore.uid, destination: home.uid, ware: "logs", reserved: false } } as unknown as SettlementActor;
  context.actors.push(actor);
  home.incoming.logs = 1;
  const cart = { uid: 5, handcart: { cargo: 0, owner: 0, state: "hitched", trip: { source: offshore.uid,
    destination: home.uid, ware: "logs", planned: 2, loaded: 0, delivered: 0, prepaid: 2 } } } as unknown as SettlementActor;
  context.actors.push(cart);
  home.incoming.logs += 2;
  context.naval = { localBoatClaims: () => 1 } as unknown as SettlementContext["naval"];
  releaseDemolishedSourcePrepayments(context, offshore);
  releaseDemolishedSourcePrepayments(context, offshore);
  expect(storageSnapshot(context, offshore)?.available.logs).toBe(11);
  expect(home.incoming.logs).toBe(0);
  expect(actor.ware).toBeNull();
  expect(cart.handcart!.trip!.prepaid).toBe(0);
  recoverDemolitionStock(context, offshore);
  expect(storageSnapshot(context, offshore)?.available.logs).toBe(13);
  expect(home.inventory.logs).toBe(10);
  expect(context.storagePools?.stranded?.[0]?.goods.boat).toBe(1);
  expect(offshore.inventory.boat).toBeUndefined();
});
