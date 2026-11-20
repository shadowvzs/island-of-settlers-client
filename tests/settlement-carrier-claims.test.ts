import { describe, expect, it } from "vitest";

import {
  CARRIER_CLAIM_LEASE_TICKS,
  carrierClaimProgress,
  deliveryLeaseExpired,
  handcartTripLeaseExpired,
  refreshCarrierClaimOnProgress,
  releaseDeliveryClaim,
  startClaimLease
} from "../src/shared/settlement/settlement-carrier-claims";
import { expireHandcartTrip } from "../src/shared/settlement/settlement-handcart-recovery";
import { updateCarrier } from "../src/shared/settlement/settlement-logistics";
import { validateSavedActors } from "../src/shared/settlement/settlement-save-actors";
import type {
  SettlementActor,
  SettlementBuilding,
  SettlementContext,
  SettlementHandcartTrip
} from "../src/shared/settlement/settlement-types";

const STORAGE = 29;
const WOODCUTTER = 17;
const building = (
  uid: number, typeId: number,
  stock: Partial<Pick<SettlementBuilding, "input" | "inventory" | "incoming" | "output">> = {}
) => ({
  uid, typeId, x: uid * 10, z: 0, y: 0, width: 4, depth: 4, rotation: 0,
  access: { x: uid * 10, z: 2 }, workerApproach: { x: uid * 10, z: 1.5 },
  doorThreshold: { x: uid * 10, z: 0.5 }, hasDoor: true,
  construction: 1, working: false, door: 0, status: "", input: {}, output: {}, inventory: {},
  incoming: {}, required: {}, accepts: {}, selected: false, cycle: 0, ...stock
} as SettlementBuilding);

const contextAt = (tick: () => number, buildings: SettlementBuilding[]) => ({
  actors: [], buildings, clock: { tick }
} as unknown as SettlementContext);

const carrier = (overrides: Partial<SettlementActor> = {}) => ({
  uid: 1, x: 0, z: 0, y: 0, yaw: 0, visible: true, job: "Carrier", action: "walk",
  phase: "deliver", building: 1, home: 0, ware: null, path: [], pathIndex: 0, timer: 0,
  animationTime: 0, ...overrides
} as SettlementActor);

const lease = (started: number, deadline: number) => ({
  leaseStartedTick: started, leaseDeadlineTick: deadline
});

describe("carrier claim leases", () => {
  it("expires exactly at the deterministic deadline", () => {
    let tick = 0;
    const context = contextAt(() => tick, [building(0, STORAGE), building(1, STORAGE)]);
    const delivery = { source: 0, destination: 1, ware: "logs", reserved: false, ...lease(0, 600) };
    tick = 599;
    expect(deliveryLeaseExpired(context, delivery)).toBe(false);
    tick = 600;
    expect(deliveryLeaseExpired(context, delivery)).toBe(true);
    expect(startClaimLease(context)).toEqual({ leaseStartedTick: 600,
      leaseDeadlineTick: 600 + CARRIER_CLAIM_LEASE_TICKS });
  });

  it("refunds a prepaid storage source before pickup and releases the destination claim", () => {
    const source = building(0, STORAGE);
    const destination = building(1, STORAGE, { incoming: { logs: 1 } });
    const context = contextAt(() => 600, [source, destination]);
    const actor = carrier({ delivery: { source: 0, destination: 1, ware: "logs", reserved: false,
      ...lease(0, 600) } });
    const released = releaseDeliveryClaim(context, actor);
    expect(released).toMatchObject({ pickedUp: false, source: 0, destination: 1 });
    expect(source.inventory.logs).toBe(1);
    expect(destination.incoming.logs).toBe(0);
    expect(actor.delivery).toBeUndefined();
    expect(actor.navigationReturnCargo).toBe(false);
    // A second release cannot refund the same trip twice.
    expect(releaseDeliveryClaim(context, actor)).toBeUndefined();
    expect(source.inventory.logs).toBe(1);
  });

  it("releases a reserved production source without adding stock, because it was never debited", () => {
    const source = building(0, WOODCUTTER, { output: { logs: 1 } });
    const destination = building(1, STORAGE, { incoming: { logs: 1 } });
    const context = contextAt(() => 600, [source, destination]);
    const actor = carrier({ delivery: { source: 0, destination: 1, ware: "logs", reserved: true,
      ...lease(0, 600) } });
    releaseDeliveryClaim(context, actor);
    expect(source.output.logs).toBe(1);
    expect(source.inventory.logs).toBeUndefined();
    expect(destination.incoming.logs).toBe(0);
  });

  it("preserves cargo after pickup and releases only the destination claim", () => {
    const source = building(0, STORAGE);
    const destination = building(1, STORAGE, { incoming: { logs: 1 } });
    const context = contextAt(() => 600, [source, destination]);
    const actor = carrier({ ware: "logs", delivery: { source: 0, destination: 1, ware: "logs",
      reserved: false, ...lease(0, 600) } });
    releaseDeliveryClaim(context, actor);
    expect(source.inventory.logs).toBeUndefined();
    expect(destination.incoming.logs).toBe(0);
    expect(actor.ware).toBe("logs");
    expect(actor.navigationReturnCargo).toBe(true);
  });

  it("expires an idle inside picker through the production carrier update", () => {
    const source = building(0, STORAGE);
    const destination = building(1, STORAGE, { incoming: { logs: 1 } });
    const context = contextAt(() => 600, [source, destination]);
    const actor = carrier({ phase: "inside", visible: false, delivery: {
      source: 0, destination: 1, ware: "logs", reserved: false, ...lease(0, 600) } });
    updateCarrier(context, actor, .05);
    expect(actor.delivery).toBeUndefined();
    expect(source.inventory.logs).toBe(1);
    expect(destination.incoming.logs).toBe(0);
  });

  it("expires an unpicked departure still indoors without manufacturing a homeward road journey", () => {
    const source = building(0, STORAGE), destination = building(1, STORAGE, { incoming: { logs: 1 } });
    const context = contextAt(() => 600, [source, destination]);
    const actor = carrier({ x: source.doorThreshold.x, z: source.doorThreshold.z,
      phase: "pickup", visible: false, delivery: { source: 0, destination: 1, ware: "logs",
        reserved: false, ...lease(0, 600) } });
    updateCarrier(context, actor, .05);
    expect(actor.delivery).toBeUndefined();
    expect(source.inventory.logs).toBe(1);
    expect(destination.incoming.logs).toBe(0);
    expect(actor).toMatchObject({ phase: "inside", visible: false, path: [],
      x: source.doorThreshold.x, z: source.doorThreshold.z });
  });

  it("restores prepaid cargo when its departure expires before crossing the home door", () => {
    const source = building(0, STORAGE), destination = building(1, STORAGE, { incoming: { logs: 1 } });
    const context = contextAt(() => 600, [source, destination]);
    const actor = carrier({ x: source.doorThreshold.x, z: source.doorThreshold.z,
      phase: "exitLoaded", visible: false, ware: "logs", delivery: {
        source: 0, destination: 1, ware: "logs", reserved: false, ...lease(0, 600) } });
    updateCarrier(context, actor, .05);
    expect(source.inventory.logs).toBe(1);
    expect(destination.incoming.logs).toBe(0);
    expect(actor).toMatchObject({ phase: "inside", visible: false, ware: null,
      x: source.doorThreshold.x, z: source.doorThreshold.z });
    expect(actor.delivery).toBeUndefined();
    expect(actor.navigationReturnCargo).toBeUndefined();
  });

  it("refreshes the lease only when the carrier actually moves or handles a unit", () => {
    const tick = 300;
    const context = contextAt(() => tick, [building(0, STORAGE), building(1, STORAGE)]);
    const actor = carrier({ delivery: { source: 0, destination: 1, ware: "logs",
      ...lease(0, 600) } });
    const before = carrierClaimProgress(actor);
    refreshCarrierClaimOnProgress(context, actor, before);
    expect(actor.delivery!.leaseDeadlineTick).toBe(600);
    actor.x = 1;
    refreshCarrierClaimOnProgress(context, actor, before);
    expect(actor.delivery!.leaseDeadlineTick).toBe(300 + CARRIER_CLAIM_LEASE_TICKS);
  });

  it("ends a cart trip before loading by refunding prepaid stock and every unfilled slot", () => {
    const source = building(0, STORAGE);
    const destination = building(1, STORAGE, { incoming: { stone: 3 } });
    const context = contextAt(() => 600, [source, destination]);
    const trip: SettlementHandcartTrip = { source: 0, destination: 1, ware: "stone", planned: 3,
      loaded: 0, delivered: 0, prepaid: 3, capacity: 3, ...lease(0, 600) };
    const actor = carrier({ phase: "cartLoading", handcart: { cargo: 0, owner: 0, state: "stored", trip } });
    expect(handcartTripLeaseExpired(context, trip)).toBe(true);
    expect(expireHandcartTrip(context, actor)).toBe(true);
    expect(source.inventory.stone).toBe(3);
    expect(destination.incoming.stone).toBe(0);
    expect(actor.handcart).toBeUndefined();
  });

  it("keeps cart cargo after pickup and parks for visible salvage instead of dropping it", () => {
    const source = building(0, STORAGE);
    const destination = building(1, STORAGE, { incoming: { stone: 2 } });
    const context = contextAt(() => 600, [source, destination]);
    const trip: SettlementHandcartTrip = { source: 0, destination: 1, ware: "stone", planned: 3,
      loaded: 3, delivered: 1, prepaid: 0, capacity: 3, ...lease(0, 600) };
    const actor = carrier({ x: 10, z: 10, yaw: 0, phase: "cartToDestination",
      handcart: { cargo: 2, owner: 0, state: "hitched", trip } });
    expect(expireHandcartTrip(context, actor)).toBe(true);
    expect(actor.handcart!.cargo).toBe(2);
    expect(actor.handcart!.trip!.destination).toBeUndefined();
    expect(actor.handcart!.trip!.leaseDeadlineTick).toBeUndefined();
    expect(destination.incoming.stone).toBe(0);
    expect(source.inventory.stone).toBeUndefined();
    expect(actor.phase).toBe("cartRecover");
    expect(actor.handcart!.state).toBe("parked");
  });
});

const savedIds = new Set([0, 1]);
const savedActor = (overrides: Record<string, unknown> = {}) => ({
  uid: 12, x: 0, z: 0, y: 0, yaw: 0, visible: true, action: "walk", job: "Carrier",
  phase: "deliver", path: [], pathIndex: 0, timer: 0, animationTime: 0, home: 0, building: 1,
  ware: "logs", ...overrides
});

describe("carrier claim save validation", () => {
  it("accepts a delivery lease whose deadline follows its start", () => {
    const actor = savedActor({ delivery: { source: 0, destination: 1, ware: "logs",
      ...lease(10, 610) } });
    expect(validateSavedActors([actor], savedIds, new Set())).toBeNull();
  });

  it("rejects a delivery lease that expires before it starts", () => {
    const actor = savedActor({ delivery: { source: 0, destination: 1, ware: "logs",
      ...lease(610, 10) } });
    expect(validateSavedActors([actor], savedIds, new Set())).toBe("Invalid delivery claim lease");
  });

  it("rejects a cart lease written backwards", () => {
    const actor = savedActor({ handcart: { cargo: 0, owner: 0, state: "stored", trip: {
      source: 0, destination: 1, ware: "logs", planned: 2, loaded: 0, delivered: 0, prepaid: 0,
      capacity: 2, ...lease(10, 5)
    } } });
    expect(validateSavedActors([actor], savedIds, new Set())).toBe("Invalid hand cart load");
  });
});
