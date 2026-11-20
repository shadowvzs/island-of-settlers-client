import { describe, expect, it } from "vitest";

import {
  admitStorageArrival, beginStorageTrafficTick, canBeginStorageExit, ownsStorageArrival
} from "../src/shared/settlement/settlement-door-traffic";
import { cancelUnreachableTask } from "../src/shared/settlement/settlement-navigation-cancellation";
import {
  holdNavigationFailure, restoreNavigationRecovery
} from "../src/shared/settlement/settlement-navigation-recovery";
import { createActor, moveActor } from "../src/shared/settlement/settlement-paths";
import { beginPersonTrafficTick } from "../src/shared/settlement/settlement-person-index";
import { updateReservationWatchdogs } from "../src/shared/settlement/settlement-reservation-watchdog";
import type { SettlementActor, SettlementPoint } from "../src/shared/settlement/settlement-types";
import { addActor, addPlot, createTrafficWorld, runTraffic } from "./helpers/traffic-scenario";

/**
 * TRAFFIC-01 reductions of the owner's 2026-10-19 save (island-settlers-2026-10-19.json), replayed
 * headlessly: each scenario keeps only the actors, plot edge and timing of one observed jam.
 */
const finishOnArrival = (movers: readonly SettlementActor[], order: number[]) => () => {
  for (const mover of movers) {
    if (!mover.visible || mover.pathIndex < mover.path.length) continue;
    order.push(mover.uid);
    Object.assign(mover, { phase: "inside", visible: false });
  }
};

describe("TRAFFIC-01: stock court waiters", () => {
  /**
   * Iron founder (save building 24): carriers 197/199/212/213 queued for its court stood 0.02 inside
   * the court edge, right on the owner's (198) lane along the edge. Being inside, they could not walk
   * to their waiting slot, and the owner could not pass them: none moved for over 300 s.
   */
  it("waiters standing just inside the court step out and the owner gets through", () => {
    const scene = createTrafficWorld(24);
    scene.context.options.canWorkerEnterPlot = () => true;
    const court = addPlot(scene, { depth: 5, doorRotation: 2, uid: 24, width: 6, x: 12, z: 12.5 });
    const contact = { x: 11.5, z: 11 };
    const crew = (uid: number, x: number, z: number, path: SettlementPoint[]) => {
      const actor = addActor(scene, { job: "Carrier", path, phase: "pickupStockWalk", uid, x, z });
      actor.stockBuilding = court.uid;
      return actor;
    };
    const owner = crew(1, 15.6, 9.75, [{ x: 15, z: 10.125 }, { x: 12.2, z: 10.125 }, contact]);
    runTraffic(scene.context, [owner], .05, { scene });
    const waiters = [crew(2, 12.6, 10.02, [contact]), crew(3, 13, 10.03, [contact]),
      crew(4, 13.4, 10.02, [contact])];
    const order: number[] = [];
    const movers = [owner, ...waiters];
    const metrics = runTraffic(scene.context, movers, 40, { afterTick: finishOnArrival(movers, order), scene });
    expect(metrics.completed).toBe(4);
    expect(order[0]).toBe(owner.uid);
  });
});

describe("TRAFFIC-01: planned legs past a stock crate", () => {
  /**
   * Leatherworks pickup (save building 22, carrier 210): the planned leg crossed a 0.02-wide sliver
   * where a full output stack's clearance met the plot edge. The planner samples a leg every 0.05,
   * the mover every step, so the carrier stood static-blocked for 109 s and blocked the court.
   */
  it("a carrier crosses a sliver its route planner accepted", () => {
    const scene = createTrafficWorld(24);
    // The save's leatherworks (type 8) with its full leather stack, shifted by (-116, -126).
    const court = addPlot(scene, { depth: 5, doorRotation: 0, typeId: 8, uid: 22, width: 5, x: 10.5, z: 10.5 });
    court.output = { leather: 6 };
    const path = [{ x: 13, z: 11.625 }, { x: 13, z: 11.5 }, { x: 13, z: 11.375 }, { x: 13, z: 11.25 },
      { x: 13.125, z: 11.125 }, { x: 13.197, z: 10.938 }];
    const carrier = addActor(scene, { job: "Carrier", path, phase: "home", uid: 1, x: 12.946, z: 11.679 });
    carrier.stockBuilding = court.uid;
    const metrics = runTraffic(scene.context, [carrier], 3, { scene });
    expect(metrics.completed).toBe(1);
  });
});

describe("TRAFFIC-01: storage door turns", () => {
  it("reserves an aged stored cart departure between arriving crews, no newer departure jumping it", () => {
    const scene = createTrafficWorld(24), { context } = scene;
    const hq = addPlot(scene, { depth: 6, doorRotation: 0, typeId: 0, uid: 0, width: 6, x: 10, z: 8 });
    const first = addActor(scene, { job: "Carrier", phase: "home", uid: 1,
      ...hq.access, path: [hq.access] });
    admitStorageArrival(context, first);
    // Civilian packhorses were retired (HORSE-RETIREMENT-01): a hitched cart is the wide crew that needs
    // the whole doorway now (the commander's mount never leaves a storage).
    const cart = addActor(scene, { job: "Carrier", phase: "pickup", uid: -1,
      visible: false, ...hq.doorThreshold });
    cart.handcart = { cargo: 0, owner: 0, state: "hitched" };
    cart.delivery = { source: 0, destination: 9, ware: "beer", reserved: true };
    expect(canBeginStorageExit(context, cart)).toBe(false);
    beginStorageTrafficTick(context, 5);
    // The old arrival has entered storage. The next arrival is younger than the cart.
    Object.assign(first, { phase: "inside", visible: false, ...hq.doorThreshold });
    const next = addActor(scene, { job: "Carrier", phase: "home", uid: 2,
      x: hq.access.x, z: hq.access.z + .5, path: [hq.access] });
    admitStorageArrival(context, next);
    expect(ownsStorageArrival(context, next)).toBe(false);
    expect(canBeginStorageExit(context, cart)).toBe(true);
    const newcomer = addActor(scene, { job: "Carrier", phase: "pickup", uid: 3,
      visible: false, ...hq.doorThreshold });
    expect(canBeginStorageExit(context, newcomer)).toBe(false);
    // A selected departure does not consume its cart or ware or bypass actual movement.
    expect(cart.visible).toBe(false);
    expect(cart.delivery.ware).toBe("beer");
    // The cart left and walks its delivery (a crew still in `pickup` would be arriving at this source).
    Object.assign(cart, { phase: "deliver", visible: true, x: 18, z: 18 });
    beginStorageTrafficTick(context, 4);
    // Once the wide cart clears, foot traffic may use both independent lanes concurrently.
    expect(canBeginStorageExit(context, newcomer)).toBe(true);
    // The waiting arrival asks again on its next step and takes the freed turn.
    admitStorageArrival(context, next);
    expect(ownsStorageArrival(context, next)).toBe(true);
  });

  it("keeps an incoming foot turn independent from a departing crew and its later return", () => {
    const scene = createTrafficWorld(24), { context } = scene;
    const hq = addPlot(scene, { depth: 6, doorRotation: 0, typeId: 0, uid: 0, width: 6, x: 10, z: 8 });
    const departing = addActor(scene, { job: "Carrier", phase: "exitLoaded", uid: 1,
      x: hq.doorThreshold.x, z: hq.doorThreshold.z + .1 });
    departing.delivery = { source: 0, destination: 9, ware: "logs", reserved: false };
    const nearby = addActor(scene, { job: "Carrier", phase: "home", uid: 2,
      x: hq.access.x, z: hq.access.z + .5, path: [hq.access] });
    admitStorageArrival(context, nearby);
    expect(ownsStorageArrival(context, nearby)).toBe(true);
    Object.assign(departing, { phase: "home", x: 3, z: 20, path: [hq.access], delivery: undefined });
    admitStorageArrival(context, nearby);
    expect(ownsStorageArrival(context, nearby)).toBe(true);
    expect(departing.storageArrivalOrder).toBeUndefined();
  });

  it("does not let a recycled carrier keep its former person's door reservation while returning from far away", () => {
    const scene = createTrafficWorld(24), { context } = scene;
    const hq = addPlot(scene, { depth: 6, doorRotation: 0, typeId: 0, uid: 0, width: 6, x: 10, z: 8 });
    hq.idleSettlers = 1;
    context.settlers = 1;
    const original = addActor(scene, { job: "Carrier", phase: "home", uid: 1,
      ...hq.access, path: [hq.access] });
    admitStorageArrival(context, original);
    expect(ownsStorageArrival(context, original)).toBe(true);
    Object.assign(original, { phase: "retired", visible: false });
    const recycled = createActor(context, "Carrier", hq.uid);
    expect(recycled).toBe(original);
    Object.assign(recycled, { visible: true, phase: "home", x: 3, z: 20, path: [hq.access] });
    expect(ownsStorageArrival(context, recycled)).toBe(false);
    const nearby = addActor(scene, { home: hq.uid, job: "Carrier", phase: "home", uid: 2,
      x: hq.access.x, z: hq.access.z + .5, path: [hq.access] });
    beginStorageTrafficTick(context, .05);
    admitStorageArrival(context, nearby);
    expect(ownsStorageArrival(context, nearby)).toBe(true);
    expect(context.settlers).toBe(0);
    expect(hq.idleSettlers).toBe(0);
    expect(recycled.x).toBe(3);
    expect(recycled.z).toBe(20);
  });

  /**
   * Headquarters (save building 0, t = 66..100 s): a burst of a dozen freshly recruited carriers left
   * the door one after another, while five arriving carriers waited about 30 s at the access.
   */
  it("an arrival that has waited takes the door turn once the departing carrier has crossed", () => {
    const { context } = createTrafficWorld(24);
    context.buildings.push({ access: { x: 10, z: 12 }, construction: 1, doorThreshold: { x: 10, z: 10 },
      typeId: 0, uid: 0, workerApproach: { x: 10, z: 11 } } as never);
    const carrier = (uid: number, phase: string, x: number, z: number, visible = true) => Object.assign(
      addActor({ context } as never, { job: "Carrier", phase, uid, visible, x, z }),
      { delivery: { destination: 0, source: 5 + uid, ware: "logs" } });
    const leaving = carrier(1, "pickup", 10, 11);
    const arriving = carrier(2, "deliver", 10.6, 13);
    arriving.path = [{ x: 10, z: 12 }];
    // Restored FIFO registrations still start a transient patience clock after loading.
    arriving.storageArrivalOrder = 100; arriving.storageArrivalBuilding = 0;
    admitStorageArrival(context, arriving);
    expect(ownsStorageArrival(context, arriving)).toBe(false);
    Object.assign(leaving, { x: 14, z: 16 });
    const next = carrier(3, "pickup", 10, 10, false);
    beginStorageTrafficTick(context, 1);
    // Departures still flow back to back while the arrival has only just queued.
    expect(canBeginStorageExit(context, next)).toBe(true);
    beginStorageTrafficTick(context, 4);
    expect(canBeginStorageExit(context, next)).toBe(false);
    expect(ownsStorageArrival(context, arriving)).toBe(true);
  });
});

describe("TRAFFIC-01: output walks to a refilled shelf", () => {
  /**
   * Winery (save building 21, vintner 24): the shelf was refilled (Fill all outputs) while the vintner
   * carried wine to slot 0. Its approach lay under crates, the route proof failed and the vintner froze
   * in its own court, holding the court reservation against three carriers.
   */
  it("walks to the current free slot instead of freezing", () => {
    const scene = createTrafficWorld(24);
    const winery = addPlot(scene, { depth: 5, doorRotation: 0, uid: 21, width: 5, x: 10.5, z: 10.5 });
    scene.context.options.canWorkerEnterPlot = () => true;
    scene.context.options.stockContact = (_building, _kind, ware, slot) => ({
      approach: { x: 9 + slot * .4, y: 0, z: 12 }, slot, stock: { x: 9 + slot * .4, y: .1, z: 12.4 }, ware
    });
    const vintner = addActor(scene, { building: winery.uid, job: "Vintner", phase: "outputWalk", uid: 1,
      ware: "wine", x: 11, z: 11, path: [{ x: 9, z: 12 }] });
    Object.assign(vintner, { stockBuilding: winery.uid,
      stockContact: { approach: { x: 9, y: 0, z: 12 }, slot: 0, stock: { x: 9, y: .1, z: 12.4 }, ware: "wine" } });
    winery.output = { wine: 6 };
    expect(cancelUnreachableTask(scene.context, vintner)).toBe(true);
    expect(vintner.phase).toBe("outputWalk");
    expect(vintner.stockContact?.slot).toBe(6);
    expect(vintner.path.at(-1)).toEqual({ x: 11.4, y: 0, z: 12 });
  });
});

describe("TRAFFIC-01: fair stock court turns", () => {
  /**
   * Bakery (save building 12): the baker fetches its inputs back to back and keeps its court across
   * the errands, so a carrier queued for the bread stack could wait about 25 s.
   */
  it("a starved waiter takes the court when the crew starts its next errand indoors", () => {
    const scene = createTrafficWorld(24);
    scene.context.options.canWorkerEnterPlot = () => true;
    const bakery = addPlot(scene, { depth: 5, doorRotation: 0, uid: 12, width: 5, x: 10.5, z: 10.5 });
    const door = { ...bakery.doorThreshold }, shelf = { x: 11.5, z: 12.4 };
    const baker = addActor(scene, { building: bakery.uid, job: "Baker", path: [shelf], phase: "inputApproach",
      uid: 1, ...door });
    const carrier = addActor(scene, { job: "Carrier", path: [{ x: 12.6, z: 12.2 }], phase: "pickupStockWalk",
      uid: 2, x: 14, z: 12.2 });
    for (const crew of [baker, carrier]) crew.stockBuilding = bakery.uid;
    const nextErrand = () => {
      const returning = baker.phase === "inputApproach";
      Object.assign(baker, { path: [returning ? door : shelf], pathIndex: 0,
        phase: returning ? "inputReturn" : "inputApproach", visible: returning, ...(returning ? {} : door) });
    };
    let admittedAt = Infinity;
    for (let tick = 1; tick <= 600 && admittedAt === Infinity; tick++) {
      beginPersonTrafficTick(scene.context);
      if (moveActor(scene.context, baker, .05)) nextErrand();
      if (moveActor(scene.context, carrier, .05)) admittedAt = tick * .05;
      updateReservationWatchdogs(scene.context, .05);
    }
    expect(admittedAt).toBeLessThan(12);
  });
});

describe("TRAFFIC-01: route failures on load", () => {
  /** Vintner 24 was saved frozen by a failed route and stayed frozen until a road or building edit. */
  it("a unit saved frozen by a failed route proves its route again on load", () => {
    const { context } = createTrafficWorld(24);
    const vintner = addActor({ context } as never, { job: "Vintner", path: [{ x: 9, z: 12 }],
      phase: "outputWalk", uid: 1, x: 11, z: 11 });
    vintner.navigationRecovery = { attempts: 0, blocked: true, elapsed: 7, notified: true,
      revision: "0/0/0", task: "outputWalk/9/12" };
    restoreNavigationRecovery(context);
    expect(holdNavigationFailure(context, vintner)).toBe(false);
    expect(vintner.navigationRecovery).toMatchObject({ attempts: 0, blocked: false, notified: true });
  });
});
