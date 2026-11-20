import { describe, expect, it } from "vitest";

import { redirectStorageDeliveries } from "../src/shared/settlement/settlement-delivery-redirect";
import { removeSettlementBuilding, updateDemolitionReturn } from "../src/shared/settlement/settlement-demolition";
import {
  admitStorageArrival, canBeginStorageExit, ownsStorageArrival, storageDoorQueueSnapshot
} from "../src/shared/settlement/settlement-door-traffic";
import { finishCartReturn } from "../src/shared/settlement/settlement-handcart-moves";
import { actorSeparation, isTrafficPassThrough } from "../src/shared/settlement/settlement-traffic";
import type { SettlementActor, SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { addActor, addPlot, createTrafficWorld, type TrafficWorld } from "./helpers/traffic-scenario";

/**
 * HQ jam reductions of the owner's save island-settlers-2026-10-20 (5): mounts and carriers
 * stalled for up to 59 s (and deadlocked once the stale turn was fixed) in the HQ door queue.
 */
const createHeadquarters = (rotation: 0 | 1 | 2 | 3 = 0) => {
  const scene = createTrafficWorld(40);
  const hq = addPlot(scene, { depth: 6, doorRotation: rotation, typeId: 0, uid: 0, width: 6, x: 10, z: 8 });
  return { context: scene.context, hq, scene };
};
const outward = (hq: SettlementBuilding, distance: number) => {
  const dx = hq.access.x - hq.doorThreshold.x, dz = hq.access.z - hq.doorThreshold.z;
  const length = Math.hypot(dx, dz);
  return { x: hq.access.x + dx / length * distance, z: hq.access.z + dz / length * distance };
};
const arrive = (scene: TrafficWorld, hq: SettlementBuilding, uid: number, distance: number, job = "Carrier") =>
  addActor(scene, { job, path: [hq.access], phase: "home", uid, ...outward(hq, distance) });
const distanceToDoorLine = (hq: SettlementBuilding, actor: SettlementActor) =>
  Math.abs((actor.x - hq.access.x) * (hq.doorThreshold.z - hq.access.z) -
    (actor.z - hq.access.z) * (hq.doorThreshold.x - hq.access.x)) /
  Math.hypot(hq.doorThreshold.x - hq.access.x, hq.doorThreshold.z - hq.access.z);

describe("HQ door jam (owner save 2026-10-20 (5))", () => {
  it.each(["Carrier", "Mount"])("releases a queued %s's old storage visit on demolition without losing cargo", job => {
    const { context, hq, scene } = createHeadquarters();
    const store = addPlot(scene, { depth: 5, doorRotation: 0, typeId: 29, uid: 18,
      width: 5, x: 28, z: 8 });
    expect(scene.roads.addRoad(hq.access, store.access)).toBe(true);
    hq.inventory.iron = 2; store.inventory.iron = 4; store.incoming.iron = 3;
    // A departing horse holds the whole doorway; a foot departure keeps to its own storage lane.
    addActor(scene, { uid: 7, home: store.uid, job: "Mount", phase: "pickup", ...store.workerApproach });
    const queued = addActor(scene, { uid: 20, home: hq.uid, job, phase: "deliver",
      ware: "iron", path: [store.access], ...outward(store, .7) });
    queued.wareUnits = 3;
    queued.delivery = { source: hq.uid, destination: store.uid, ware: "iron", reserved: false };
    admitStorageArrival(context, queued);
    expect(queued.storageArrivalBuilding).toBe(store.uid);
    expect(storageDoorQueueSnapshot(context, store.uid).actors.find(actor => actor.uid === queued.uid)?.waiting)
      .toBeDefined();
    context.transfers = [];
    removeSettlementBuilding(context, store);
    expect(queued.storageArrivalBuilding).toBeUndefined();
    expect(queued.queueTarget).toBeUndefined();
    expect(queued.delivery).toBeUndefined();
    expect(store.incoming.iron).toBe(0);
    const pooledIron = (context.storagePools?.pools ?? []).reduce((sum, pool) => sum + (pool.available.iron ?? 0), 0);
    expect(hq.inventory.iron + queued.wareUnits + pooledIron).toBe(9);
    expect(queued.ware).toBe("iron");
    updateDemolitionReturn(context, queued, .05);
    expect(admitStorageArrival(context, queued)).toBe(true);
    expect(queued.storageArrivalBuilding).toBeUndefined();
  });
  it("clears the former shoulder when the receiving policy reroutes a queued loaded carrier", () => {
    const { context, hq, scene } = createHeadquarters();
    const store = addPlot(scene, { depth: 5, doorRotation: 0, typeId: 29, uid: 18,
      width: 5, x: 28, z: 8 });
    expect(scene.roads.addRoad(hq.access, store.access)).toBe(true);
    addActor(scene, { uid: 7, home: store.uid, job: "Carrier", phase: "pickup", ...store.workerApproach });
    const carrier = addActor(scene, { uid: 20, home: hq.uid, job: "Carrier", phase: "deliver",
      ware: "iron", path: [store.access], ...outward(store, .7) });
    carrier.delivery = { source: hq.uid, destination: store.uid, ware: "iron", reserved: false };
    store.incoming.iron = 1;
    admitStorageArrival(context, carrier);
    expect(carrier.storageArrivalBuilding).toBe(store.uid);
    store.accepts.iron = false;
    expect(redirectStorageDeliveries(context, store.uid, "iron")).toBe(1);
    expect(carrier.delivery.destination).toBe(hq.uid);
    expect(store.incoming.iron).toBe(0);
    expect(hq.incoming.iron).toBe(1);
    expect(admitStorageArrival(context, carrier)).toBe(true);
    expect(carrier.storageArrivalBuilding).toBeUndefined();
    expect(carrier.queueTarget).toBeUndefined();
    expect(carrier.ware).toBe("iron");
  });
  it.each([0, 1, 2, 3] as const)("leaves horse-sized clearance between staged followers at rotation %i", rotation => {
    const { context, hq, scene } = createHeadquarters(rotation);
    const owner = arrive(scene, hq, 100, 0);
    admitStorageArrival(context, owner);
    Object.assign(owner, { phase: "enterHome", ...outward(hq, -.5) });
    const first = arrive(scene, hq, -1, 2.4, "Mount");
    const direction = outward(hq, 1);
    const sideways = { x: -(direction.z - hq.access.z), z: direction.x - hq.access.x };
    const second = arrive(scene, hq, -2, .6, "Mount");
    const third = arrive(scene, hq, -3, .6, "Mount");
    second.x += sideways.x * 2; second.z += sideways.z * 2;
    third.x -= sideways.x * 2; third.z -= sideways.z * 2;
    for (const horse of [first, second, third]) admitStorageArrival(context, horse);
    const queue = storageDoorQueueSnapshot(context, hq.uid).actors;
    const a = queue.find(actor => actor.uid === second.uid)!.waiting!;
    const b = queue.find(actor => actor.uid === third.uid)!.waiting!;
    expect(a).toBeDefined(); expect(b).toBeDefined();
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(actorSeparation(second, third) + .02);
  });

  it("retains a remote pickup arrival's turn against departures from the destination storage", () => {
    const { context, hq, scene } = createHeadquarters();
    const store = addPlot(scene, { depth: 5, doorRotation: 0, typeId: 29, uid: 18,
      width: 5, x: 28, z: 8 });
    const horse = addActor(scene, { home: hq.uid, job: "Mount", phase: "pickup", uid: -8,
      path: [store.access], ...outward(store, .5) });
    horse.delivery = { source: store.uid, destination: 9, ware: "grain" };
    admitStorageArrival(context, horse);
    expect(ownsStorageArrival(context, horse)).toBe(true);
    const leaving = addActor(scene, { home: store.uid, job: "Carrier", phase: "pickup", uid: 7,
      visible: false, ...store.doorThreshold });
    leaving.delivery = { source: hq.uid, destination: 9, ware: "water" };
    expect(canBeginStorageExit(context, leaving)).toBe(false);
  });
  it("forgets a stored horse's old shoulder when it departs for another storage", () => {
    const { context, hq, scene } = createHeadquarters();
    const store = addPlot(scene, { depth: 5, doorRotation: 0, typeId: 29, uid: 18,
      width: 5, x: 28, z: 8 });
    const blocker = addActor(scene, { home: store.uid, job: "Carrier", phase: "pickup", uid: 7,
      ...store.workerApproach });
    const horse = addActor(scene, { home: store.uid, job: "Mount", phase: "home", uid: -7,
      path: [store.access], ...outward(store, .7) });
    admitStorageArrival(context, horse);
    expect(storageDoorQueueSnapshot(context, store.uid).actors.find(actor => actor.uid === horse.uid)?.waiting)
      .toBeDefined();
    // Horses retain the same actor object when stored and dispatched again.
    Object.assign(blocker, { phase: "inside", visible: false });
    Object.assign(horse, { phase: "pickup", visible: false, ...store.doorThreshold,
      path: [store.workerApproach, store.access, hq.access], pathIndex: 0,
      delivery: { source: hq.uid, destination: 9, ware: "water" } });
    const promise = horse.delivery;
    canBeginStorageExit(context, horse);
    Object.assign(horse, { visible: true, ...outward(store, 2), pathIndex: 1 });
    expect(admitStorageArrival(context, horse)).toBe(true);
    expect(horse.storageArrivalBuilding).toBeUndefined();
    expect(horse.queueTarget).toBeUndefined();
    expect(horse.delivery).toBe(promise);
  });

  it("drops an old storage waiting place when a visible loaded delivery is redirected far away", () => {
    const { context, hq, scene } = createHeadquarters();
    const store = addPlot(scene, { depth: 5, doorRotation: 0, typeId: 29, uid: 18,
      width: 5, x: 28, z: 8 });
    addActor(scene, { home: store.uid, job: "Carrier", phase: "pickup", uid: 7,
      ...store.workerApproach });
    const carrier = addActor(scene, { home: store.uid, job: "Carrier", phase: "deliver", uid: 20,
      ware: "iron", path: [store.access], ...outward(store, .7) });
    carrier.delivery = { source: 3, destination: store.uid, ware: "iron", reserved: false };
    admitStorageArrival(context, carrier);
    expect(carrier.storageArrivalBuilding).toBe(store.uid);
    carrier.delivery.destination = hq.uid;
    carrier.path = [hq.access]; carrier.pathIndex = 0;
    expect(admitStorageArrival(context, carrier)).toBe(true);
    expect(carrier.storageArrivalBuilding).toBeUndefined();
    expect(carrier.ware).toBe("iron");
  });
  /** Mount #-4 kept FIFO order 510 from an earlier visit and held the turn 25 tiles away. */
  it("never hands the door turn to a registered arrival far out of range", () => {
    const { context, hq, scene } = createHeadquarters();
    const far = arrive(scene, hq, -4, 25, "Mount");
    Object.assign(far, { storageArrivalBuilding: hq.uid, storageArrivalOrder: 1 });
    const near = arrive(scene, hq, 2, .4);
    admitStorageArrival(context, near);
    expect(ownsStorageArrival(context, far)).toBe(false);
    expect(ownsStorageArrival(context, near)).toBe(true);
  });

  /** Carrier #1612's returning cart stopped 0.63 from the access and stayed parked in the HQ lane. */
  it("shelves a returning cart that stops on the access apron", () => {
    const { context, hq, scene } = createHeadquarters();
    const puller = addActor(scene, { job: "Carrier", phase: "cartReturn", uid: 1612, ...outward(hq, .63) });
    puller.handcart = { owner: hq.uid, state: "hitched" } as SettlementActor["handcart"];
    finishCartReturn(context, puller);
    expect(puller.handcart).toBeUndefined();
    expect(hq.handcarts).toBe(1);
    expect(puller.phase).toBe("home");
  });

  /** Unloaded mount #-3 kept standing on the entrance line while another crew used the door. */
  it("moves a waiter held on the entrance line to a side slot", () => {
    const { context, hq, scene } = createHeadquarters();
    const leaving = addActor(scene, { job: "Carrier", phase: "pickup", uid: 1, ...hq.workerApproach });
    leaving.delivery = { destination: 9, reserved: false, source: 8, ware: "logs" };
    const horse = arrive(scene, hq, -3, 0, "Mount");
    // A saved waiting place on the line: the horse is already where it believes it should wait.
    horse.queueWait = .5;
    admitStorageArrival(context, horse);
    expect(ownsStorageArrival(context, horse)).toBe(false);
    expect(horse.queueTarget).toBeDefined();
    expect(distanceToDoorLine(hq, { ...horse, ...horse.queueTarget! })).toBeGreaterThan(.7);
  });

  /** Led horse #-1, pushed back onto the road while entering, lost its turn to an exiting carrier. */
  it("keeps the turn of an entering crew pushed back out of the doorway", () => {
    const { context, hq, scene } = createHeadquarters();
    const entering = arrive(scene, hq, -1, 0, "Mount");
    admitStorageArrival(context, entering);
    Object.assign(entering, { phase: "enterHome", ...outward(hq, .7) });
    const next = arrive(scene, hq, 2, 1.5);
    admitStorageArrival(context, next);
    expect(ownsStorageArrival(context, entering)).toBe(true);
    const exiting = addActor(scene, { job: "Carrier", phase: "pickup", uid: 3, visible: false, ...hq.doorThreshold });
    exiting.delivery = { destination: 9, reserved: false, source: 8, ware: "logs" };
    expect(canBeginStorageExit(context, exiting)).toBe(false);
  });

  it("lets the earlier storage FIFO arrival pass later queue members", () => {
    const { context, scene } = createHeadquarters();
    const store = addPlot(scene, { depth: 5, doorRotation: 0, typeId: 29, uid: 18, width: 5, x: 28, z: 8 });
    const earlier = arrive(scene, store, 1, 2);
    const later = arrive(scene, store, 2, 2.3);
    Object.assign(earlier, { storageArrivalBuilding: store.uid, storageArrivalOrder: 4 });
    Object.assign(later, { storageArrivalBuilding: store.uid, storageArrivalOrder: 5 });
    expect(isTrafficPassThrough(context, earlier, later)).toBe(true);
    expect(isTrafficPassThrough(context, later, earlier)).toBe(false);
  });

  it("does not let a carrier leaving another building hold the HQ turn", () => {
    const { context, hq, scene } = createHeadquarters();
    const workshop = addPlot(scene, { depth: 4, doorRotation: 0, typeId: 10, uid: 7, width: 4, x: 30, z: 30 });
    addActor(scene, { building: workshop.uid, job: "Carrier", phase: "exitDelivery", uid: 1,
      ...workshop.workerApproach });
    const near = arrive(scene, hq, 2, .4);
    admitStorageArrival(context, near);
    expect(ownsStorageArrival(context, near)).toBe(true);
  });
});
