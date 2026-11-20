import { describe, expect, it } from "vitest";

import { createShippingDemand } from "../src/shared/settlement/settlement-shipping-demand";
import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { registerStorageAccess, storageSnapshot } from "../src/shared/settlement/shared-storage";
import { createStorageCollectShipping } from "../src/shared/settlement/storage-collect-shipping";
import { BLOCKING, type WorldData } from "../src/shared/world/world-data";

const building = (uid: number, x: number, typeId = 39) => ({ uid, typeId, x, z: 5,
  construction: 1, inventory: {}, input: {}, output: {}, incoming: {}, required: {}, accepts: {},
  access: { x, z: 5 }, workerApproach: { x, z: 5 }, doorThreshold: { x, z: 5 }
}) as unknown as SettlementBuilding;
const fixture = () => {
  const cellsX = 64, cellsZ = 12, blocking = new Uint8Array(cellsX * cellsZ);
  for (let z = 0; z < cellsZ; z++) for (const x of [20, 21]) blocking[z * cellsX + x] = BLOCKING.water;
  const source = building(0, 10), destination = building(1, 40);
  const context = { buildings: [source, destination], actors: [], settlers: 0,
    options: { world: { cellsX, cellsZ, blocking } as WorldData,
      roads: { route: (from: { x: number }, to: { x: number }) => from.x === to.x ? { cost: 0 } : null } }
  } as unknown as SettlementContext;
  registerStorageAccess(context, source); registerStorageAccess(context, destination);
  const from = context.storagePools!.pools.find(pool => pool.id === source.storagePoolId)!;
  const to = context.storagePools!.pools.find(pool => pool.id === destination.storagePoolId)!;
  from.available.logs = 100; to.collect = ["logs"];
  let coverage = 0;
  const calls: Array<{ source: number; destination: number; cargo: Record<string, number> }> = [];
  const hooks = { canReachHarbour: () => true, expeditionDemand: () => ({}), shipyardDemand: () => ({}),
    hasIdleShipAt: () => true, transportDistance: () => 20,
    fleetCoverage: () => coverage, fleetPoolCoverage: (pool: number) => pool === to.id ? coverage : 0,
    queueTransport: (uid: number, target: number, cargo: Record<string, number>) => {
      calls.push({ source: uid, destination: target, cargo: { ...cargo } });
      for (const [ware, count] of Object.entries(cargo)) {
        from.available[ware] = (from.available[ware] ?? 0) - count; coverage += count;
      }
      return calls.length;
    } };
  return { context, source, destination, from, to, calls, hooks, setCoverage: (amount: number) => { coverage = amount; } };
};

describe("Collect uses ordinary shipping and real pool ownership", () => {
  it("ships selected surplus in legal batches across reload, accounts for inflight cargo and stops when deselected", () => {
    const scene = fixture();
    let shipping = createShippingDemand(scene.context, scene.hooks);
    shipping.reconcile();
    expect(scene.calls[0]!.cargo).toEqual({ logs: 40 });
    const saved = structuredClone(shipping.saveState());
    shipping = createShippingDemand(scene.context, scene.hooks);
    shipping.restore(saved);
    shipping.reconcile();
    expect(scene.calls[1]!.cargo).toEqual({ logs: 40 });
    expect(scene.from.available.logs).toBe(20);
    scene.to.collect = [];
    shipping.reconcile();
    expect(scene.calls).toHaveLength(2);
    expect(shipping.demands()[0]).toMatchObject({ fleet: 80, need: 80, outstanding: 0 });
    scene.setCoverage(0); shipping.reconcile();
    expect(shipping.demands()).toEqual([]);
  });

  it("retains true local consumer needs and private holds instead of sweeping their source stock", () => {
    const scene = fixture();
    scene.from.available.logs = 20;
    scene.source.shipReserve = { logs: 7 }; // Already outside free stock; do not subtract it a second time.
    const plan = createStorageCollectShipping(scene.context, [{ destinationUid: scene.source.uid,
      harbourUid: scene.source.uid, ware: "logs", need: 12, local: 2, network: 20, incoming: 3, fleet: 0 }], scene.hooks);
    expect(plan.surplus(scene.source, "logs")).toBe(13);
    expect(plan.targets[0]).toMatchObject({ need: 13, ware: "logs" });
  });

  it("does not steal a soft next-delivery reservation whose goods are still free in the source pool", () => {
    const scene = fixture();
    scene.from.available.logs = 20;
    scene.context.actors = [{ uid: 9, nextDelivery: { source: scene.source.uid,
      destination: scene.source.uid, ware: "logs", units: 4 } }] as unknown as SettlementContext["actors"];
    const plan = createStorageCollectShipping(scene.context, [{ destinationUid: scene.source.uid,
      harbourUid: scene.source.uid, ware: "logs", need: 4, local: 0, network: 20, incoming: 4, fleet: 0 }], scene.hooks);
    expect(plan.surplus(scene.source, "logs")).toBe(16);
  });

  it("preserves one shared alternative-food buffer without reserving a full buffer for every food", () => {
    const scene = fixture(), mine = building(5, 12, 10);
    mine.worker = 90;
    scene.context.buildings.push(mine);
    scene.from.available = { fish: 1, meat: 3, bread: 3 };
    const plan = createStorageCollectShipping(scene.context, [], scene.hooks);
    expect(plan.surplus(scene.source, "fish")).toBe(0);
    expect(plan.surplus(scene.source, "meat")).toBe(2);
    expect(plan.surplus(scene.source, "bread")).toBe(3);
  });

  it("respects recipient pool room including existing inflight commitments", () => {
    const scene = fixture(), shipping = createShippingDemand(scene.context, scene.hooks);
    const capacity = storageSnapshot(scene.context, scene.destination)!.capacity;
    scene.to.available.logs = capacity;
    shipping.reconcile();
    const room = scene.calls[0]?.cargo.logs ?? 0;
    expect(room).toBeLessThanOrEqual(40);
    // Free room is feasibility, never an invented collection need.
    expect(scene.calls).toHaveLength(0);
    scene.to.available.logs = capacity - 10;
    scene.setCoverage(8);
    shipping.reconcile();
    expect(scene.calls[0]?.cargo.logs).toBe(2);
  });

  it("revalidates shared room after another preplanned job reserves cargo at a different pool harbour", () => {
    const scene = fixture(), other = building(2, 42), site = building(3, 42, 10);
    scene.context.buildings.push(other, site); registerStorageAccess(scene.context, other);
    site.construction = 0; site.required = { planks: 2000 }; site.worker = 90;
    scene.context.options.roads.route = (from, to) => (from.x < 20) === (to.x < 20)
      ? { points: [], cost: Math.abs(from.x - to.x), length: 1 } : null;
    scene.from.available = { planks: 100 }; scene.to.collect = ["planks"];
    scene.to.available = { planks: storageSnapshot(scene.context, scene.destination)!.capacity - 50 };
    createShippingDemand(scene.context, scene.hooks).reconcile();
    expect(scene.calls.reduce((sum, call) => sum + (call.cargo.planks ?? 0), 0)).toBe(50);
    expect(scene.from.available.planks).toBe(50);
  });

  it("is inactive without two harbour pools and never donates a ware selected by its source", () => {
    const scene = fixture();
    scene.from.collect = ["logs"];
    const plan = createStorageCollectShipping(scene.context, [], scene.hooks);
    expect(plan.surplus(scene.source, "logs")).toBe(0);
    expect(plan.targets).toEqual([]);
    scene.from.collect = []; scene.context.buildings.splice(0, 1);
    expect(createStorageCollectShipping(scene.context, [], scene.hooks).targets).toEqual([]);
  });

  it("keeps one saved recipient across multiple same-pool harbours and ignores unselected wares", () => {
    const scene = fixture(), newer = building(2, 42);
    scene.context.buildings.push(newer); registerStorageAccess(scene.context, newer);
    scene.to.collectHarbourUid = newer.uid;
    scene.from.available.stone = 20;
    const plan = createStorageCollectShipping(scene.context, [], scene.hooks);
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]).toMatchObject({ destinationUid: newer.uid, ware: "logs" });
    expect(scene.to.collectHarbourUid).toBe(newer.uid);
  });
});
