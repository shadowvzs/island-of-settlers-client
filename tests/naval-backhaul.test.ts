import { describe, expect, it } from "vitest";

import { createNavalBackhaul, transportOrderNeed, validNavalBackhaul } from "../src/shared/settlement/settlement-naval-backhaul";
import type { NavalOrder, NavalShip } from "../src/shared/settlement/settlement-naval-fleet";
import { createNavalFleet } from "../src/shared/settlement/settlement-naval-fleet";
import { createNavalOrders, type NavalOrdersOptions } from "../src/shared/settlement/settlement-naval-orders";
import { createShipSea } from "./helpers/ship-motion-scenarios";

const ship = (id: number, phase: NavalShip["phase"] = "unloading"): NavalShip => ({
  cargo: { stone: 2 }, cargoCount: 2, cursor: 0, destinationUid: 0, id, phase,
  route: [], sourceUid: 1, timer: 20, x: 4, y: 0, yaw: 0, z: 4
});
const order = (id: number): NavalOrder => ({ cargo: { planks: 3 }, destinationUid: 2, id, sourceUid: 0 });

const scheduler = (ships: NavalShip[], orders: NavalOrder[], extra: Partial<NavalOrdersOptions> = {}) => {
  const calls: number[] = [];
  const route = (moving: NavalShip) => { calls.push(moving.id); moving.phase = "positioning"; return true; };
  const berthing = { dock: () => ({ x: 4, z: 4 }), harbor: () => ({ inventory: {} }),
    routeToBerth: route, route, accepting: () => true };
  const policy = createNavalOrders({ berthing, chooseUnload: () => true, ferrySpot: () => null,
    orders, planner: { route: () => [] }, releaseLoad: () => {}, ships, takeOrderId: () => 10, ...extra
  } as unknown as NavalOrdersOptions);
  return { calls, policy };
};

describe("owned ship backhaul reservations", () => {
  it("keeps a remote empty hull idle while the source ship physically unloads, then takes its next leg", () => {
    const arriving = ship(1), remote = { ...ship(2, "idle"), cargo: {}, cargoCount: 0, timer: 0 }, pending = order(3);
    const ships = [arriving, remote], orders = [pending], { calls, policy } = scheduler(ships, orders);
    policy.assignOrders(.05);
    expect(calls).toEqual([]);
    expect(arriving).toMatchObject({ cargo: { stone: 2 }, nextOrderId: 3, phase: "unloading", sourceUid: 1 });
    expect(pending.preferredShipId).toBe(1);
    expect(validNavalBackhaul(ships, orders)).toBe(true);
    // Actual unload completion clears the old leg; the promise survives that boundary and reload.
    Object.assign(arriving, { cargo: {}, cargoCount: 0, phase: "idle", sourceUid: undefined, timer: 0 });
    const restored = structuredClone({ ships, orders });
    expect(validNavalBackhaul(restored.ships, restored.orders)).toBe(true);
    const next = scheduler(restored.ships, restored.orders);
    next.policy.assignOrders(.05);
    expect(next.calls).toEqual([1]);
    expect(restored.ships[0]).toMatchObject({ cargo: { planks: 3 }, orderId: 3, sourceUid: 0 });
    expect(restored.ships[0]!.nextOrderId).toBeUndefined();
    expect(restored.orders).toHaveLength(0);
  });

  it("hands over only after actual fleet unloading, reloads the promise and credits the old cargo once", () => {
    const sea = createShipSea(), a = sea.harbour(20), b = sea.harbour(44), c = sea.harbour(68);
    b.inventory = { planks: 3 };
    const fleet = createNavalFleet(sea.context, sea.sea);
    const berth = fleet.harbourBerths(b.uid)[0]!;
    expect(berth).toBeDefined();
    fleet.addShip(berth, berth.yaw ?? 0);
    fleet.addShip({ x: 70, z: 95 });
    const arriving = fleet.saveState().ships[0]!;
    Object.assign(arriving, { cargo: { stone: 2 }, cargoCount: 2, destinationUid: b.uid,
      phase: "unloading", sourceUid: a.uid, timer: .2, transfer: { load: { stone: 2 } } });
    const id = fleet.queueTransport(b.uid, c.uid, { planks: 3 });
    expect(id).not.toBeNull();
    expect(arriving.nextOrderId).toBe(id);
    fleet.update(.05);
    expect(arriving.phase).toBe("unloading");
    expect(fleet.saveState().ships[1]!.phase).toBe("idle");
    const restored = createNavalFleet(sea.context, sea.sea);
    restored.restore(structuredClone(fleet.saveState()));
    for (let tick = 0; tick < 12; tick++) restored.update(.05);
    expect(b.inventory.stone).toBe(2);
    expect(restored.saveState().ships[0]).toMatchObject({ orderId: id, sourceUid: b.uid });
    expect(restored.saveState().ships[0]!.nextOrderId).toBeUndefined();
    expect(restored.saveState().ships[1]!.phase).toBe("idle");
    expect(b.shipReserve).toEqual({ planks: 3 });
  });

  it("waits for every current passenger to land before taking the reserved ordinary passenger return", () => {
    const sea = createShipSea(), a = sea.harbour(20), b = sea.harbour(44);
    let landed = false;
    const releases: Array<{ ids: number[]; uid: number }> = [];
    const hooks = { ready: () => true, embark: () => {}, unloadPassengers: () => landed,
      release: (ids: readonly number[], uid: number) => releases.push({ ids: [...ids], uid }) };
    const fleet = createNavalFleet(sea.context, sea.sea, hooks), berth = fleet.harbourBerths(b.uid)[0]!;
    fleet.addShip(berth, berth.yaw ?? 0);
    fleet.addShip({ x: 70, z: 95 });
    const current = fleet.saveState().ships[0]!;
    Object.assign(current, { cargo: {}, cargoCount: 1, destinationUid: b.uid, passengers: [11],
      phase: "unloading", sourceUid: a.uid, timer: .2 });
    // IDs are the existing passenger adapter's already reserved manifests, never new crew withdrawals.
    const id = fleet.queueTransport(b.uid, a.uid, {}, [22])!;
    expect(current.nextOrderId).toBe(id);
    for (let tick = 0; tick < 10; tick++) fleet.update(.05);
    expect(current).toMatchObject({ passengers: [11], phase: "unloading" });
    expect(releases).toEqual([]);
    expect(fleet.saveState().ships[1]!.phase).toBe("idle");
    const restored = createNavalFleet(sea.context, sea.sea, hooks);
    restored.restore(structuredClone(fleet.saveState()));
    landed = true;
    for (let tick = 0; tick < 8; tick++) restored.update(.05);
    expect(releases).toEqual([{ ids: [11], uid: b.uid }]);
    expect(restored.saveState().ships[0]).toMatchObject({ orderId: id, passengers: [22], sourceUid: b.uid });
    expect(restored.saveState().ships[1]!.phase).toBe("idle");
  });

  it("reuses an empty local parking return before dispatching a remote empty hull", () => {
    const returning = { ...ship(1, "sailing"), anchorage: { x: 10, z: 10 }, cargo: {},
      cargoCount: 0, lastHarbourUid: 0, timer: 0 };
    const remote = { ...ship(2, "idle"), cargo: {}, cargoCount: 0, timer: 0 };
    const orders = [order(3)], { calls, policy } = scheduler([returning, remote], orders);
    policy.assignOrders(.05);
    expect(calls).toEqual([1]);
    expect(returning).toMatchObject({ orderId: 3, sourceUid: 0 });
    expect(returning.anchorage).toBeUndefined();
    expect(remote.phase).toBe("idle");
  });

  it("cancels an unloading ship's future job once and refunds only its untouched next cargo", () => {
    const sea = createShipSea(), a = sea.harbour(20), b = sea.harbour(44);
    b.inventory = { planks: 3 };
    const fleet = createNavalFleet(sea.context, sea.sea), berth = fleet.harbourBerths(b.uid)[0]!;
    fleet.addShip(berth, berth.yaw ?? 0);
    const current = fleet.saveState().ships[0]!;
    Object.assign(current, { cargo: { stone: 2 }, cargoCount: 2, destinationUid: b.uid,
      phase: "unloading", sourceUid: a.uid, timer: 20 });
    const id = fleet.queueTransport(b.uid, a.uid, { planks: 3 })!;
    expect(current.nextOrderId).toBe(id);
    expect(fleet.cancelTransport(id)).toBe(true);
    expect(fleet.cancelTransport(id)).toBe(false);
    expect(current.nextOrderId).toBeUndefined();
    expect(current).toMatchObject({ cargo: { stone: 2 }, phase: "unloading", sourceUid: a.uid });
    expect(b.inventory.planks).toBe(3);
    expect(b.shipReserve).toBeUndefined();
  });

  it("ranks uncapped target need first and reconsiders unstarted claims without changing the current load", () => {
    const current = ship(1), small = order(3), large = order(4);
    small.cargo = { planks: 40 }; large.cargo = { planks: 40 };
    large.demand = { planks: 200 };
    expect(transportOrderNeed(large)).toBe(200);
    let need = 200;
    const policy = createNavalBackhaul([current], [small, large], {
      remainingNeed: next => next.id === 4 ? need : 50,
      routeDistance: next => next.id === 4 ? 100 : 1
    });
    policy.reconcile();
    expect(current.nextOrderId).toBe(4); // Both carry40; target200 still outranks target50.
    expect(large.preferredShipId).toBe(1);
    need = 10;
    policy.reconcile();
    expect(current.nextOrderId).toBe(3);
    expect(large.preferredShipId).toBeUndefined();
    expect(current.cargo).toEqual({ stone: 2 });
  });

  it("uses valid transport distance before request age when target deficits tie", () => {
    const current = ship(1), older = order(3), nearer = order(4);
    let nearDistance = 12;
    const policy = createNavalBackhaul([current], [older, nearer], {
      remainingNeed: () => 50, routeDistance: next => next.id === 3 ? 30 : nearDistance
    });
    policy.reconcile();
    expect(current.nextOrderId).toBe(4);
    nearDistance = Infinity;
    policy.reconcile();
    expect(current.nextOrderId).toBe(3);
  });

  it("applies largest-need next-job selection to a free ship rather than only to unloading claims", () => {
    const free = { ...ship(1, "idle"), cargo: {}, cargoCount: 0, timer: 0 };
    const small = order(3), large = order(4);
    const { policy } = scheduler([free], [small, large], { remainingNeed: next => next.id === 4 ? 200 : 50 });
    policy.assignOrders(.05);
    expect(free.orderId).toBe(4);
  });

  it("uses oldest request only as a need/distance tie and rejects forged or duplicate links", () => {
    const ships = [ship(1)], orders = [order(3), order(4)];
    const policy = createNavalBackhaul(ships, orders);
    policy.reconcile(); policy.reconcile();
    expect(orders.map(row => row.preferredShipId)).toEqual([1, undefined]);
    expect(validNavalBackhaul(ships, orders)).toBe(true);
    orders[1]!.preferredShipId = 1;
    expect(validNavalBackhaul(ships, orders)).toBe(false);
    policy.release(orders[0]!);
    expect(ships[0]!.nextOrderId).toBeUndefined();
  });

  it("does not commandeer visitors, founding hulls, expedition reservations or over-capacity jobs", () => {
    const visitor = { ...ship(1), visitor: { role: "supply" } } as NavalShip;
    const reserved = { ...ship(2), reservedFor: -1 }, founding = { ...ship(3), foundingSiteUid: 5 };
    const ordinary = ship(4), passenger = { ...order(1), passengers: Array.from({ length: 41 }, (_, index) => index) }, cargo = order(2);
    createNavalBackhaul([visitor, reserved, founding, ordinary], [passenger, cargo]).reconcile();
    expect(passenger.preferredShipId).toBeUndefined();
    expect(cargo.preferredShipId).toBe(4);
    expect(ordinary.cargo).toEqual({ stone: 2 });
  });

  it("releases obsolete next-leg promises without changing existing cargo or reissuing a reservation", () => {
    const current = ship(1), pending = order(3), ships = [current], orders = [pending];
    const policy = createNavalBackhaul(ships, orders);
    policy.reconcile();
    orders.splice(0, 1);
    policy.reconcile();
    expect(current.nextOrderId).toBeUndefined();
    expect(current.cargo).toEqual({ stone: 2 });
  });
});
