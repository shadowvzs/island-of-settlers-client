import { describe, expect, it } from "vitest";

import {
  collectShippingDemandTargets, createShippingDemand, type ShippingDemandHooks, type ShippingDemandSave
} from "../src/shared/settlement/settlement-shipping-demand";
import type { Goods, SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";

type Point = { x: number; z: number };
const NETWORK = (point: Point) => point.x < 20 ? 0 : 1;
const route = (start: Point, end: Point) => NETWORK(start) === NETWORK(end) ? {
  points: [], cost: Math.hypot(start.x - end.x, start.z - end.z), length: 1
} : null;
const building = (uid: number, typeId: number, x: number, extra: Partial<SettlementBuilding> = {}) => ({
  uid, typeId, x, z: 10, y: 1, rotation: 0, width: 3, depth: 3, access: { x, z: 10 },
  workerApproach: { x, z: 10 }, doorThreshold: { x, z: 10 }, hasDoor: true, construction: 1,
  working: false, door: 0, status: "", input: {}, output: {}, inventory: {}, incoming: {},
  required: {}, accepts: {}, selected: false, cycle: 0, ...extra
}) as SettlementBuilding;
const context = (buildings: SettlementBuilding[], clock: { tick: () => number },
  settings: { playerNation?: string; settlers?: number } = {}) => ({
  buildings, clock, settlers: settings.settlers ?? 10, playerNation: settings.playerNation ?? "roman",
  options: { roads: { route } }
}) as unknown as SettlementContext;
const hooks = (overrides: Partial<ShippingDemandHooks> = {}) => {
  const calls: { cargo: Goods; destination: number; source: number }[] = [];
  const carried: Record<string, number> = {};
  let nextOrder = 40;
  const base: ShippingDemandHooks = {
    canReachHarbour: () => true,
    expeditionDemand: () => ({}),
    fleetCoverage: (destination, ware) => carried[`${destination}|${ware}`] ?? 0,
    hasIdleShipAt: () => true,
    queueTransport: (source, destination, cargo) => {
      calls.push({ cargo: { ...cargo }, destination, source });
      for (const [ware, count] of Object.entries(cargo))
        carried[`${destination}|${ware}`] = (carried[`${destination}|${ware}`] ?? 0) + count;
      return nextOrder++;
    },
    shipyardDemand: () => ({})
  };
  return { calls, carried, hooks: { ...base, ...overrides } };
};
const advanceSeconds = (clock: { tick: () => number; advance: (ticks: number) => void }, seconds: number) =>
  clock.advance(Math.round(seconds / 0.05));

describe("ISLAND-06 durable destination demand", () => {
  it("ships Catapult ammunition after construction and counts local and incoming stone once", () => {
    const clock = { tick: () => 0 };
    const harbour = building(1, 39, 2, { inventory: { stone: 1 } });
    const source = building(2, 39, 24, { inventory: { stone: 20 } });
    const tower = building(3, 16, 4, { input: { stone: 1 }, incoming: { stone: 2 } });
    const fake = hooks();
    const live = context([harbour, source, tower], clock);
    const targets = collectShippingDemandTargets(live, fake.hooks);
    expect(targets).toMatchObject([{ destinationUid: 1, ware: "stone", need: 6,
      local: 1, network: 1, incoming: 2 }]);
    const demand = createShippingDemand(live, fake.hooks);
    demand.update(.05);
    expect(fake.calls).toEqual([{ cargo: { stone: 2 }, destination: 1, source: 2 }]);
    expect(demand.demands()).toMatchObject([{ ware: "stone", stock: 2, incoming: 2, fleet: 2, outstanding: 0 }]);
    tower.militaryFaction = 1;
    expect(collectShippingDemandTargets(live, fake.hooks)).toEqual([]);
  });

  it("derives construction, tool and production targets and aggregates them at the receiving harbour", () => {
    let tick = 0;
    const clock = { tick: () => tick, advance: (amount: number) => { tick += amount; } };
    const harbour = building(1, 39, 2, { accepts: {} });
    const site = building(2, 10, 4, { construction: 0, foundationProgress: 0, required: { planks: 4, stone: 6 },
      input: { planks: 1 }, incoming: { stone: 2 } });
    const mill = building(3, 31, 6, { worker: 90 });
    const live = context([harbour, site, mill], clock);
    const targets = collectShippingDemandTargets(live, { expeditionDemand: () => ({}), shipyardDemand: () => ({}) });
    const byWare = Object.fromEntries(targets.map(entry => [entry.ware, entry]));
    expect(byWare.planks).toMatchObject({ destinationUid: 1, need: 4, local: 1, network: 0 });
    expect(byWare.stone).toMatchObject({ destinationUid: 1, need: 6, incoming: 2 });
    expect(byWare.shovel).toMatchObject({ destinationUid: 1, need: 1 });
    expect(byWare.grain).toMatchObject({ destinationUid: 1, need: 2 });
  });
  it("batches compatible wares, waits with an age bound, then binds one real order without repeats", () => {
    let tick = 0;
    const clock = { tick: () => tick, advance: (amount: number) => { tick += amount; } };
    const harbour = building(1, 39, 2);
    const source = building(2, 39, 24, { inventory: { planks: 2, stone: 2 } });
    const site = building(3, 10, 4, { construction: 0, foundationProgress: 1, required: { planks: 1, stone: 1 },
      worker: 90 });
    const live = context([harbour, source, site], clock);
    const fake = hooks();
    const demand = createShippingDemand(live, fake.hooks);
    demand.update(0.05);
    expect(fake.calls).toHaveLength(0);
    expect(demand.demands().every(entry => entry.reason === "batching")).toBe(true);
    advanceSeconds(clock, 8);
    demand.notify();
    demand.update(0.05);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.cargo).toEqual({ planks: 1, stone: 1 });
    for (let step = 0; step < 100; step++) demand.update(0.05);
    expect(fake.calls).toHaveLength(1);
    expect(demand.demands().every(entry => entry.orderId === 40)).toBe(true);
    expect(demand.demands().every(entry => entry.status === "in-transit")).toBe(true);
  });
  it("reports shortage, route loss, full storage and reduced demand honestly", () => {
    let tick = 0;
    const clock = { tick: () => tick, advance: (amount: number) => { tick += amount; } };
    const harbour = building(1, 39, 2);
    const site = building(3, 10, 4, { construction: 0, foundationProgress: 1, required: { planks: 2 }, worker: 90 });
    const live = context([harbour, site], clock);
    const shortage = createShippingDemand(live,
      hooks({ hasIdleShipAt: () => true }).hooks);
    shortage.update(0.05);
    expect(shortage.demands()[0]).toMatchObject({ reason: "no-source", status: "outstanding" });
    const source = building(2, 39, 24, { inventory: { planks: 2 } });
    const routeLost = createShippingDemand(context([harbour, source, site], clock),
      hooks({ canReachHarbour: () => false }).hooks);
    routeLost.update(0.05);
    expect(routeLost.demands()[0]).toMatchObject({ reason: "route-lost", status: "blocked" });
    const full = context([harbour, source, site], clock);
    const other = building(4, 39, 5);
    full.buildings.push(other);
    other.incoming.planks = 1_000_000;
    const fullDemand = createShippingDemand(full, hooks().hooks);
    fullDemand.update(0.05);
    expect(fullDemand.demands()[0]?.reason).toBe("storage-full");
  });
  it("keeps coverage from a changed need, then closes it once cargo is delivered", () => {
    let tick = 0;
    const clock = { tick: () => tick, advance: (amount: number) => { tick += amount; } };
    const harbour = building(1, 39, 2);
    const source = building(2, 39, 24, { inventory: { planks: 4 } });
    const site = building(3, 10, 4, { construction: 0, foundationProgress: 1, required: { planks: 4 }, worker: 90 });
    const live = context([harbour, source, site], clock);
    const fake = hooks();
    const demand = createShippingDemand(live, fake.hooks);
    demand.update(0.05);
    expect(fake.calls[0]!.cargo).toEqual({ planks: 4 });
    site.required = {};
    demand.notify();
    demand.update(0.05);
    expect(demand.demands()).toMatchObject([{ reason: "reduced", status: "in-transit" }]);
    fake.carried["1|planks"] = 0;
    harbour.inventory.planks = 4;
    demand.notify();
    demand.update(0.05);
    expect(demand.demands()).toEqual([]);
  });
  it("uses one group target for shared alternative foods, not one request per food", () => {
    let tick = 0;
    const clock = { tick: () => tick, advance: (amount: number) => { tick += amount; } };
    const harbour = building(1, 39, 2);
    const mine = building(3, 10, 4, { worker: 90 });
    const empty = collectShippingDemandTargets(context([harbour, mine], clock),
      { expeditionDemand: () => ({}), shipyardDemand: () => ({}) });
    const foods = empty.filter(entry => ["fish", "meat", "bread"].includes(entry.ware));
    expect(foods).toHaveLength(1);
    expect(foods[0]?.ware).toBe("fish");
    mine.input.fish = 1;
    const fed = collectShippingDemandTargets(context([harbour, mine], clock),
      { expeditionDemand: () => ({}), shipyardDemand: () => ({}) });
    expect(fed.filter(entry => ["fish", "meat", "bread"].includes(entry.ware))).toEqual([]);
  });
  it("does not count a ship reservation or another destination's cargo as free stock", () => {
    let tick = 0;
    const clock = { tick: () => tick, advance: (amount: number) => { tick += amount; } };
    const harbour = building(1, 39, 2);
    const source = building(2, 39, 24, { inventory: { planks: 4 }, shipReserve: { planks: 4 } });
    const site = building(3, 10, 4, { construction: 0, foundationProgress: 1, required: { planks: 2 },
      worker: 90 });
    const fake = hooks();
    const demand = createShippingDemand(context([harbour, source, site], clock), fake.hooks);
    demand.update(0.05);
    expect(fake.calls).toHaveLength(0);
    expect(demand.demands()[0]).toMatchObject({ reason: "no-source", outstanding: 2 });
    const carried = hooks();
    carried.carried["9|planks"] = 2;
    const other = createShippingDemand(context([harbour, source, site], clock), carried.hooks);
    other.update(0.05);
    expect(carried.calls).toHaveLength(0);
    expect(other.demands()[0]?.outstanding).toBe(2);
  });
  it("moves an uncovered need to a newly reachable closer receiving harbour", () => {
    let tick = 0;
    const clock = { tick: () => tick, advance: (amount: number) => { tick += amount; } };
    const harbour = building(1, 39, 2);
    const source = building(2, 39, 24, { inventory: { planks: 4 } });
    const site = building(3, 10, 4, { construction: 0, foundationProgress: 1, required: { planks: 2 },
      worker: 90 });
    const live = context([harbour, source, site], clock);
    const demand = createShippingDemand(live, hooks({ hasIdleShipAt: () => false }).hooks);
    demand.update(0.05);
    expect(demand.demands()[0]).toMatchObject({ destinationUid: 1, reason: "no-ship" });
    const closer = building(5, 39, 5);
    live.buildings.push(closer);
    demand.notify();
    demand.update(0.05);
    expect(demand.demands()).toMatchObject([{ destinationUid: 5, reason: "no-ship" }]);
  });
  it("restores saved records and reconciles a missed trigger without duplicate ids or orders", () => {
    let tick = 0;
    const clock = { tick: () => tick, advance: (amount: number) => { tick += amount; } };
    const harbour = building(1, 39, 2);
    const source = building(2, 39, 24, { inventory: { planks: 4 } });
    const site = building(3, 10, 4, { construction: 0, foundationProgress: 1, required: { planks: 4 }, worker: 90 });
    const live = context([harbour, source, site], clock);
    const fake = hooks();
    const demand = createShippingDemand(live, fake.hooks);
    demand.update(0.05);
    const saved = JSON.parse(JSON.stringify(demand.saveState())) as ShippingDemandSave;
    const restoredFake = hooks();
    restoredFake.carried["1|planks"] = 4;
    const restored = createShippingDemand(live, restoredFake.hooks);
    restored.restore(saved);
    restored.update(0.05);
    expect(restored.demands()).toHaveLength(1);
    expect(restoredFake.calls).toHaveLength(0);
    expect(new Set(restored.demands().map(entry => entry.id)).size).toBe(1);
    expect(restored.demands()[0]!.id).toBe(saved.demands[0]!.id);
    expect(restored.saveState().nextDemand).toBe(saved.nextDemand);
  });
  it("retains uncapped target deficit for ranking while dispatching only a legal forty-unit ship load", () => {
    const harbour = building(1, 39, 2);
    const source = building(2, 39, 24, { inventory: { planks: 250 } });
    const site = building(3, 10, 4, { construction: 0, foundationProgress: 1,
      required: { planks: 200 }, worker: 90 });
    const live = context([harbour, source, site], { tick: () => 0 });
    let sent: { cargo: Goods; demand?: Goods } | undefined;
    const fake = hooks({ queueTransport: (_from, _to, cargo, demand) => {
      sent = { cargo, demand }; return 1;
    } });
    createShippingDemand(live, fake.hooks).update(.05);
    expect(sent).toEqual({ cargo: { planks: 40 }, demand: { planks: 200 } });
  });

  it.each([
    { goal: 200, nearDistance: 1, targetDistance: 50 },
    { goal: 50, nearDistance: 30, targetDistance: 10 }
  ])("ranks automatic jobs before a single available hull is claimed: $goal target", settings => {
    const home = building(1, 39, 2), other = building(4, 39, 16);
    const source = building(2, 39, 24, { inventory: { planks: 50 } });
    const oldSite = building(3, 10, 4, { construction: 0, foundationProgress: 1,
      required: { planks: 50 }, worker: 90 });
    const newSite = building(5, 10, 14, { construction: 0, foundationProgress: 1,
      required: { planks: settings.goal }, worker: 90 });
    let claimed = false;
    const calls: number[] = [];
    const fake = hooks({ hasIdleShipAt: () => !claimed,
      transportDistance: (_from, destination) => destination === 4 ? settings.targetDistance : settings.nearDistance,
      queueTransport: (_from, destination) => { claimed = true; calls.push(destination); return 1; } });
    createShippingDemand(context([home, source, oldSite, other, newSite], { tick: () => 0 }), fake.hooks).update(.05);
    expect(calls).toEqual([4]);
  });

});

it("preserves the pending reconciliation timer instead of changing update timestamps after loading", () => {
  let tick = 10;
  const live = context([], { tick: () => tick });
  const first = createShippingDemand(live, hooks().hooks);
  first.update(.05);first.update(.1);
  const saved = structuredClone(first.saveState());
  expect(saved.dirty).toBe(false);
  expect(saved.timer).toBeGreaterThan(0);
  const restored = createShippingDemand(live, hooks().hooks);restored.restore(saved);
  tick++;
  first.update(.05);restored.update(.05);
  expect(restored.saveState()).toEqual(first.saveState());
});
