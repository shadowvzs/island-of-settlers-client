import { describe, expect, it } from "vitest";

import {
  admitStorageArrival, beginStorageTrafficTick, canBeginStorageExit
} from "../src/shared/settlement/settlement-door-traffic";
import {
  doorWaitSnapshot, enableDoorWaitMetrics
} from "../src/shared/settlement/settlement-door-wait-metrics";
import { addActor, addPlot, createTrafficWorld, type TrafficWorld } from "./helpers/traffic-scenario";

/**
 * The wait receipt is opt-in and read-only: these checks pin its per-actor accounting without
 * asserting wall-clock timing or changing any admission result.
 */
const createHeadquarters = () => {
  const scene = createTrafficWorld(40);
  const hq = addPlot(scene, { depth: 6, doorRotation: 0, typeId: 0, uid: 0, width: 6, x: 10, z: 8 });
  return { context: scene.context, hq, scene };
};
const arrive = (scene: TrafficWorld, building: ReturnType<typeof addPlot>, uid: number) =>
  addActor(scene, { path: [building.access], phase: "home", uid, ...building.access });

describe("storage-door wait metrics", () => {
  it("records the FIFO registration-to-admission wait without changing the owner", () => {
    const { context, hq, scene } = createHeadquarters();
    enableDoorWaitMetrics(context);
    const first = arrive(scene, hq, 1);
    const second = arrive(scene, hq, 2);
    expect(admitStorageArrival(context, first)).toBe(true);
    expect(admitStorageArrival(context, second)).toBe(true);
    // The first arrival owns the door; the second is still registered behind it.
    expect(doorWaitSnapshot(context).completedCount).toBe(1);
    expect(doorWaitSnapshot(context).activeCount).toBe(1);
    beginStorageTrafficTick(context, 2);
    // The first crew enters (leaves the approach); the second can then take the free door.
    context.actors = context.actors.filter(actor => actor !== first);
    // The new owner first clears its parked waiting place, then its short retry cooldown.
    let completed = false;
    for (let tick = 0; tick < 40 && !completed; tick++) {
      beginStorageTrafficTick(context, .05);
      admitStorageArrival(context, second);
      completed = doorWaitSnapshot(context).completedCount === 2;
    }
    expect(completed).toBe(true);
    const metrics = doorWaitSnapshot(context);
    expect(metrics.completedCount).toBe(2);
    expect(metrics.activeCount).toBe(0);
    expect(metrics.maxObservedSeconds).toBeGreaterThanOrEqual(2);
    expect(Math.max(...metrics.completed.map(sample => sample.seconds))).toBeGreaterThanOrEqual(2);
  });

  it("records one hidden-departure wait per request, not one per tick", () => {
    const { context, hq, scene } = createHeadquarters();
    enableDoorWaitMetrics(context);
    const arrival = arrive(scene, hq, 1);
    admitStorageArrival(context, arrival);
    const departure = addActor(scene, {
      building: 0, home: 0, job: "Mount", phase: "pickup", uid: 2, visible: false, ...hq.access
    });
    departure.delivery = { destination: 9, reserved: false, source: 8, ware: "logs" };
    expect(canBeginStorageExit(context, departure)).toBe(false);
    expect(doorWaitSnapshot(context).departureActiveCount).toBe(1);
    beginStorageTrafficTick(context, 3);
    expect(canBeginStorageExit(context, departure)).toBe(false);
    expect(doorWaitSnapshot(context).departureActiveCount).toBe(1);
    context.actors = context.actors.filter(actor => actor !== arrival);
    expect(canBeginStorageExit(context, departure)).toBe(true);
    const metrics = doorWaitSnapshot(context);
    expect(metrics.departureCount).toBe(1);
    expect(metrics.departureActiveCount).toBe(0);
    expect(metrics.departureCompleted[0]?.seconds).toBeGreaterThanOrEqual(3);
    // The pending request still exists, but it must not create a second zero-wait sample.
    expect(canBeginStorageExit(context, departure)).toBe(true);
    expect(doorWaitSnapshot(context).departureCount).toBe(1);
  });
});
