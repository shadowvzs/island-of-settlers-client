import { describe, expect, it } from "vitest";

import {
  admitStorageArrival, beginStorageTrafficTick, ownsStorageArrival
} from "../src/shared/settlement/settlement-door-traffic";
import { clearingStorageArrival, exitPath, isOwnDoorLane } from "../src/shared/settlement/settlement-entrance";
import { updateCarrier } from "../src/shared/settlement/settlement-logistics";
import { moveActor } from "../src/shared/settlement/settlement-paths";
import { beginPersonTrafficTick } from "../src/shared/settlement/settlement-person-index";
import { addActor, addPlot, createTrafficWorld } from "./helpers/traffic-scenario";

const fixture = () => {
  const scene = createTrafficWorld(40);
  const store = addPlot(scene, { depth: 5, doorRotation: 0, typeId: 29, uid: 18,
    width: 5, x: 20.5, z: 15.5 });
  // The Japanese storehouse has an interior hall, longer than the generic fixture's doorstep.
  store.doorThreshold = { x: store.workerApproach.x, z: store.workerApproach.z - 1.57 };
  return { scene, store, context: scene.context };
};

describe("storage doorway continuation (owner save 2026-10-25)", () => {
  it("lets a returning carrier clear the hall ahead of a departing horse and resumes hidden departures", () => {
    const { context, scene, store } = fixture();
    const horse = addActor(scene, { uid: -6, job: "Mount", home: store.uid, phase: "pickup",
      ...store.doorThreshold, path: [...exitPath(store), { x: store.access.x, z: store.access.z + 3 }] });
    horse.delivery = { source: 27, destination: 10, ware: "pig", reserved: true };
    const returning = addActor(scene, { uid: 3228, job: "Carrier", home: store.uid, building: store.uid,
      phase: "home", x: store.doorThreshold.x, z: store.doorThreshold.z + .25,
      path: [store.workerApproach, store.access] });
    Object.assign(returning, { storageArrivalBuilding: store.uid, storageArrivalOrder: 1069,
      ware: "meat", navigationReturnCargo: true });
    store.inventory = { meat: 2, hammer: 2 };
    store.incoming = { meat: 1 };
    const recruit = addActor(scene, { uid: 3263, job: "Recruit", home: store.uid,
      phase: "assigned", visible: false, ...store.doorThreshold,
      path: [...exitPath(store), { x: store.access.x - 3, z: store.access.z + 1 }] });
    let smallestDistance = Infinity;
    for (let tick = 0; tick < 600; tick++) {
      beginStorageTrafficTick(context, .05);
      beginPersonTrafficTick(context);
      moveActor(context, horse, .05);
      updateCarrier(context, returning, .05);
      moveActor(context, recruit, .05);
      if (returning.visible) smallestDistance = Math.min(smallestDistance,
        Math.hypot(returning.x - horse.x, returning.z - horse.z));
    }
    expect(horse.pathIndex).toBe(horse.path.length);
    expect(recruit.visible).toBe(true);
    expect(recruit.pathIndex).toBe(recruit.path.length);
    expect(returning.phase).toBe("inside");
    expect(returning.visible).toBe(false);
    expect(returning.storageArrivalOrder).toBe(1069);
    expect(smallestDistance).toBeGreaterThanOrEqual(.25);
    expect(store.inventory).toEqual({ meat: 3, hammer: 2 });
    expect(store.incoming).toEqual({ meat: 1 });
    expect(horse.delivery).toEqual({ source: 27, destination: 10, ware: "pig", reserved: true });
  });

  it("grants only the storage's narrow outward hall leg, retaining saved arrival identity", () => {
    const { context, scene, store } = fixture();
    const actor = addActor(scene, { uid: 3228, job: "Carrier", home: store.uid, phase: "home",
      x: store.doorThreshold.x, z: store.doorThreshold.z + .25, path: [store.workerApproach, store.access] });
    actor.storageArrivalBuilding = store.uid;
    actor.storageArrivalOrder = 1069;
    expect(clearingStorageArrival(context, actor)).toBe(store);
    addActor(scene, { uid: -6, job: "Mount", home: store.uid, phase: "pickup",
      ...store.doorThreshold, path: [...exitPath(store), { x: store.access.x, z: store.access.z + 3 }] });
    const outside = addActor(scene, { uid: 3877, job: "Carrier", home: store.uid, phase: "home",
      x: store.access.x, z: store.access.z + 1, path: [store.access] });
    admitStorageArrival(context, outside);
    expect(ownsStorageArrival(context, actor)).toBe(true);
    expect(ownsStorageArrival(context, outside)).toBe(false);
    expect(isOwnDoorLane(context, actor, store.workerApproach)).toBe(true);
    expect(isOwnDoorLane(context, actor, store.doorThreshold)).toBe(false);
    // Beside both foot lanes (±.25 off the centre line): the paired storage door grants no wider strip.
    expect(isOwnDoorLane(context, actor, { x: store.workerApproach.x + .6, z: actor.z })).toBe(false);
    actor.path = [store.doorThreshold, store.access];
    expect(clearingStorageArrival(context, actor)).toBeUndefined();
    actor.path = [store.workerApproach, { x: store.access.x + 2, z: store.access.z }];
    expect(clearingStorageArrival(context, actor)).toBeUndefined();
    expect(actor.storageArrivalOrder).toBe(1069);
  });

  it("uses the pickup source door when the carrier belongs to another storage", () => {
    const { context, scene, store } = fixture();
    const actor = addActor(scene, { uid: 3877, job: "Carrier", home: 0, phase: "pickup",
      x: store.doorThreshold.x, z: store.doorThreshold.z + .25, path: [store.workerApproach, store.access] });
    actor.delivery = { source: store.uid, destination: 37, ware: "meat", reserved: false };
    expect(clearingStorageArrival(context, actor)).toBe(store);
    expect(isOwnDoorLane(context, actor, store.workerApproach)).toBe(true);
    actor.x += .6; // clear of the +.25 inward foot lane as well as the centre line
    expect(clearingStorageArrival(context, actor)).toBeUndefined();
  });
});
