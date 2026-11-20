import { describe, expect, it } from "vitest";

import { updateCarrier } from "../src/shared/settlement/settlement-logistics";
import {
  findGroundPath, isNavigationEscapeClear,
  isNavigationFootprintClear,
  searchGroundPath
} from "../src/shared/settlement/settlement-navigation";
import { cancelUnreachableTask } from "../src/shared/settlement/settlement-navigation-cancellation";
import {
  beginActorMovement,
  holdNavigationFailure,
  recordMovementOutcome,
  restoreNavigationRecovery,
  saveNavigationRecovery,
  saveNavigationRevisionAliases,
  updateNavigationRecovery
} from "../src/shared/settlement/settlement-navigation-recovery";
import {
  beginPersonTrafficTick,
  nearbyTrafficActors,
  updatePersonTraffic
} from "../src/shared/settlement/settlement-person-index";
import {
  beginNavigationRepairTick,
navigationRepairMetrics,
  requestNavigationRepair} from "../src/shared/settlement/settlement-repair-budget";
import {
  actorSeparation,
  anticipatedTrafficBlocker,
  isSeparatingTrafficStep,
  isTrafficSegmentClear} from "../src/shared/settlement/settlement-traffic";
import { resetTrafficWork, snapshotTrafficWork } from "../src/shared/settlement/settlement-traffic-counters";
import type {
  SettlementActor,
  SettlementBuilding,
  SettlementContext
} from "../src/shared/settlement/settlement-types";
import { recoverResourceApproach } from "../src/shared/settlement/settlement-worker-resource-recovery";

const actor = (uid: number, x = 2, z = 2): SettlementActor => ({
  uid,
  x,
  z,
  y: 0,
  yaw: 0,
  job: "Carrier",
  visible: true,
  action: "carry",
  ware: "logs",
  phase: "deliver",
  building: 1,
  home: 0,
  path: [{ x: 8, z: 2 }],
  pathIndex: 0,
  timer: 0,
  animationTime: 0
});
const fixture = () => {
  const size = 16;
  const context = {
    actors: [],
    buildings: [],
    occupied: new Uint8Array(size ** 2),
    reservations: new Set(),
    options: {
      world: {
        cellsX: size,
        cellsZ: size,
        buildRevision: 0,
        heights: new Float32Array((size + 1) ** 2),
        walkCost: new Uint8Array(size ** 2).fill(10),
        props: { count: 0 }
      },
      roads: { revision: 0 }
    }
  } as unknown as SettlementContext;
  return context;
};
const sample = (
  context: SettlementContext,
  unit: SettlementActor,
  seconds: number,
  outcome = "static-blocked"
) => {
  for (let step = 0; step < seconds * 20; step++) {
    beginNavigationRepairTick(context, 0.05);
    beginActorMovement(unit);
    recordMovementOutcome(unit, outcome as Parameters<typeof recordMovementOutcome>[1]);
    updateNavigationRecovery(
      context,
      unit,
      0.05,
      (path) => {
        unit.path = path;
        unit.pathIndex = 0;
      },
      () => false
    );
  }
};

it.each(["navalBoarding", "navalDeckWalk", "navalAboard"])(
  "leaves an owned passenger's authored %s route to naval movement", phase => {
    const context = fixture(), passenger = actor(7);
    Object.assign(passenger, { phase, navalOrder: 4, ware: null, y: 2.5,
      navigationRecovery: { blocked: true } });
    expect(holdNavigationFailure(context, passenger)).toBe(false);
    expect(passenger.navigationRecovery).toBeUndefined();
    const path = passenger.path;
    sample(context, passenger, 30);
    expect(passenger.navigationRecovery).toBeUndefined();
    expect(passenger.path).toBe(path);
    expect(passenger.y).toBe(2.5);
  });

describe("person traffic index", () => {
  it("retains original blocker priority and horse separation after sequential movement, hiding and spawning", () => {
    const context = fixture();
    const unit = actor(9),
      older = actor(4, 2.05),
      horse = actor(-1, 2.2);
    horse.job = "Mount";
    context.actors.push(unit, older, horse);
    const before = isTrafficSegmentClear(context, unit, { x: 2.04, z: 2 }, true);
    const prediction = anticipatedTrafficBlocker(context, unit, { x: 8, z: 2 }, 1.2);
    beginPersonTrafficTick(context);
    expect(isTrafficSegmentClear(context, unit, { x: 2.04, z: 2 }, true)).toBe(before);
    expect(anticipatedTrafficBlocker(context, unit, { x: 8, z: 2 }, 1.2)).toBe(prediction);
    expect(actorSeparation(unit, horse)).toBe(0.46);
    older.x = 10;
    updatePersonTraffic(context, older);
    horse.visible = false;
    updatePersonTraffic(context, horse);
    expect(nearbyTrafficActors(context, unit, 0.46)).toEqual([unit]);
    const spawned = actor(11, 2.1);
    context.actors.push(spawned);
    updatePersonTraffic(context, spawned);
    expect(nearbyTrafficActors(context, unit, 0.46)).toEqual([unit, spawned]);
  });
});

describe("repair search ownership", () => {
  it("caps grants and gives deferred actors priority over previously admitted actors", () => {
    const context = fixture();
    const units = [actor(0), actor(1), actor(2), actor(3)];
    context.actors.push(...units);
    expect(units.map((unit) => requestNavigationRepair(context, unit))).toEqual([
      true,
      true,
      false,
      false
    ]);
    beginNavigationRepairTick(context, 0.25);
    expect(requestNavigationRepair(context, units[0]!)).toBe(false);
    expect(requestNavigationRepair(context, units[2]!)).toBe(true);
    expect(requestNavigationRepair(context, units[3]!)).toBe(true);
  });
  it("distinguishes an exhausted search from an actually sealed component", () => {
    const context = fixture();
    expect(
      searchGroundPath(context, { x: 2, z: 2 }, { x: 8, z: 2 }, undefined, undefined, 0.5, 1).status
    ).toBe("budget-exhausted");
    for (let z = 0; z < 16; z++) context.options.world.walkCost[z * 16 + 5] = 0;
    expect(
      searchGroundPath(context, { x: 2, z: 2 }, { x: 8, z: 2 }, undefined, undefined, 0.5, 2048)
        .status
    ).toBe("no-path");
  });
  it("rejects a centre-clear shore or foundation edge when the foot disk overlaps it", () => {
    const context = fixture();
    context.options.world.walkCost[2 * 16 + 3] = 0;
    expect(isNavigationFootprintClear(context, { x: 2.9, z: 2.5 })).toBe(false);
    context.options.world.walkCost[2 * 16 + 3] = 10;
    context.occupied[2 * 16 + 3] = 1;
    expect(isNavigationFootprintClear(context, { x: 2.9, z: 2.5 })).toBe(false);
    expect(isNavigationFootprintClear(context, { x: 2.9, z: 2.5 }, () => true)).toBe(true);
  });
});

describe("simulated five-second progress", () => {
  it("retains an inherited revision alias through indoor work before a new navigation task", () => {
    const live = fixture(), person = actor(0); live.actors.push(person);
    person.navigationRecovery = { task: "previous", elapsed: 0, attempts: 0,
      revision: "1596/20/20", blocked: false, notified: false };
    restoreNavigationRecovery(live);
    person.navigationRecovery = undefined;
    const aliases = saveNavigationRevisionAliases(live);
    expect(aliases).toHaveLength(1);
    const copy = structuredClone(person), cold = fixture(); cold.actors.push(copy);
    restoreNavigationRecovery(cold, true, aliases);
    for (const [context, unit] of [[live, person], [cold, copy]] as const) {
      beginActorMovement(unit); recordMovementOutcome(unit, "moving");
      updateNavigationRecovery(context, unit, .05, () => undefined, () => false);
    }
    expect(person.navigationRecovery!.revision).toBe("1596/20/20");
    expect(saveNavigationRecovery(copy)).toEqual(saveNavigationRecovery(person));
  });
  it("proves a frozen unit again at a load without the revision epoch, keeps it frozen with it", () => {
    for (const retained of [false, true]) {
      const context = fixture(), unit = actor(3);
      context.actors.push(unit);
      unit.navigationRecovery = { attempts: 1, blocked: true, elapsed: 9, notified: true, revision: "1/1/1",
        task: "t" };
      restoreNavigationRecovery(context, retained);
      expect(unit.navigationRecovery.blocked).toBe(retained);
    }
  });
  it.each([false, true])("keeps a resumed walker identical between progress samples (route replaced:%s)", replaceRoute => {
    const context = fixture(), unit = actor(19);
    context.actors.push(unit);
    const advance = (owner: SettlementContext, walker: SettlementActor) => {
      beginActorMovement(walker);
      walker.x += .035;
      recordMovementOutcome(walker, "moving");
      updateNavigationRecovery(owner, walker, .05, () => { throw new Error("false repair"); }, () => false);
    };
    for (let tick = 0; tick < 8; tick++) advance(context, unit);
    if (replaceRoute) unit.path = unit.path.map(point => ({ ...point }));
    const restored = JSON.parse(JSON.stringify({ ...unit, navigationRecovery: saveNavigationRecovery(unit) })) as SettlementActor;
    const fresh = fixture(); fresh.actors.push(restored);
    restoreNavigationRecovery(fresh);
    expect(saveNavigationRecovery(restored)).toEqual(saveNavigationRecovery(unit));
    for (let tick = 0; tick < 30; tick++) {
      advance(context, unit); advance(fresh, restored);
      expect(saveNavigationRecovery(restored)).toEqual(saveNavigationRecovery(unit));
    }
  });
  it("never repairs valid door queues or ongoing work after more than five seconds", () => {
    for (const outcome of ["door-queue", "stock-wait", "interaction"]) {
      const context = fixture(),
        unit = actor(0);
      context.actors.push(unit);
      sample(context, unit, 12, outcome);
      expect(unit.navigationRecovery?.attempts).toBe(0);
      expect(unit.navigationRecovery?.blocked).toBe(false);
    }
  });
  it("does not treat moving away from the final destination on a winding route as a stall", () => {
    const context = fixture(),
      unit = actor(0);
    unit.path = [
      { x: 2, z: 10 },
      { x: 8, z: 10 },
      { x: 8, z: 2 }
    ];
    context.actors.push(unit);
    for (let tick = 0; tick < 140; tick++) {
      unit.z += 0.035;
      beginActorMovement(unit);
      recordMovementOutcome(unit, "moving");
      updateNavigationRecovery(
        context,
        unit,
        0.05,
        () => {
          throw new Error("false repair");
        },
        () => false
      );
    }
    expect(unit.navigationRecovery?.attempts).toBe(0);
    expect(unit.navigationRecovery!.elapsed).toBeLessThan(1);
  });
  it("retains cargo, task and reservations with one notification when a destination is blocked", () => {
    const context = fixture(),
      unit = actor(0);
    context.actors.push(unit);
    context.options.world.walkCost[2 * 16 + 8] = 0;
    const events: unknown[] = [];
    context.options.onNavigationFailure = (event) => events.push(event);
    sample(context, unit, 4.9);
    expect(unit.navigationRecovery?.blocked).toBe(false);
    sample(context, unit, 0.2);
    expect(unit.navigationRecovery?.blocked).toBe(true);
    expect(unit.ware).toBe("logs");
    expect(unit.phase).toBe("deliver");
    expect(events).toHaveLength(1);
    expect(holdNavigationFailure(context, unit)).toBe(true);
    const restored = JSON.parse(JSON.stringify(unit)) as SettlementActor;
    expect(holdNavigationFailure(context, restored)).toBe(true);
    context.options.world.buildRevision = (context.options.world.buildRevision ?? 0) + 1;
    expect(holdNavigationFailure(context, restored)).toBe(false);
    expect(restored.ware).toBe("logs");
  });
});

it("cancels reserved production output and paid storage dispatches exactly once, returning actual cargo physically", () => {
  for (const mode of ["reserved", "paid", "held"] as const) {
    const context = fixture(),
      unit = actor(0);
    context.actors.push(unit);
    const home = {
      uid: 0,
      typeId: 0,
      construction: 1,
      x: 2,
      z: 5,
      width: 3,
      depth: 3,
      access: { x: 2, z: 7 },
      workerApproach: { x: 2, z: 6.8 },
      doorThreshold: { x: 2, z: 6 },
      inventory: { logs: 4 },
      output: { logs: 1 },
      incoming: {}
    } as unknown as SettlementBuilding;
    const destination = { ...home, uid: 1, incoming: { logs: 1 }, inventory: {} };
    context.buildings.push(home, destination);
    if (mode === "reserved") home.typeId = 17;
    unit.ware = mode === "held" ? "logs" : null;
    unit.delivery = { source: 0, destination: 1, ware: "logs", reserved: mode === "reserved" };
    expect(cancelUnreachableTask(context, unit)).toBe(true);
    expect(cancelUnreachableTask(context, unit)).toBe(false);
    expect(destination.incoming.logs).toBe(0);
    expect(home.output.logs).toBe(1);
    expect(home.inventory.logs).toBe(mode === "paid" ? 5 : 4);
    if (mode !== "held") continue;
    expect(unit.ware).toBe("logs");
    Object.assign(unit, home.doorThreshold);
    unit.phase = "enterHome";
    unit.path = [];
    unit.pathIndex = 0;
    updateCarrier(context, unit, 0.05);
    expect(home.inventory.logs).toBe(5);
    expect(unit.ware).toBeNull();
    updateCarrier(context, unit, 0.05);
    expect(home.inventory.logs).toBe(5);
  }
});

it("breaks a persistent opposing cycle with one physical backout and never relocates through blocked terrain", async () => {
  const { recordTrafficBlocker, requestTrafficCycleBackout } =
    await import("../src/shared/settlement/settlement-traffic-deadlock");
  const context = fixture(),
    first = actor(0),
    second = actor(1, 2.18);
  second.path = [{ x: 1, z: 2 }];
  context.actors.push(first, second);
  for (let tick = 0; tick < 50; tick++) {
    recordTrafficBlocker(first, second, 0.05);
    recordTrafficBlocker(second, first, 0.05);
  }
  expect(requestTrafficCycleBackout(context, first)).toBe(false);
  expect(requestTrafficCycleBackout(context, second)).toBe(true);
  expect(first.queueTarget).toBeUndefined();
  expect(second.queueTarget).toBeDefined();
  expect(second.x).toBe(2.18);
  expect(second.z).toBe(2);
  expect(second.ware).toBe("logs");
  second.queueTarget = undefined;
  context.options.world.walkCost.fill(0);
  for (let tick = 0; tick < 50; tick++) recordTrafficBlocker(second, first, 0.05);
  expect(requestTrafficCycleBackout(context, second)).toBe(false);
  expect(second.x).toBe(2.18);
});

it("releases a saved exhausted pickup journey when the onward road disappeared, keeping ware ownership", () => {
  for (const mode of ["reserved", "paid"] as const) for (const phase of ["pickup", "enterPickup"]) {
    const context = fixture(), unit = actor(296);
    context.actors.push(unit);
    const home = { uid: 0, typeId: 0, construction: 1, x: 2, z: 5, width: 3, depth: 3,
      access: { x: 2, z: 7 }, workerApproach: { x: 2, z: 6.8 },
      doorThreshold: { x: 2, z: 6 }, inventory: { planks: 4 }, output: {}, incoming: {} } as unknown as SettlementBuilding;
    const source = { ...home, uid: 9, typeId: mode === "reserved" ? 33 : 29,
      x: 8, output: { planks: 1 }, inventory: { planks: 4 } };
    const destination = { ...home, uid: 19, x: 12, incoming: { planks: 1 }, inventory: {} };
    context.buildings.push(home, source, destination);
    context.options.roads.route = () => null;
    unit.phase = phase; unit.ware = null; unit.building = 19;
    // Existing save reached the end before the road disappeared.
    unit.path = [{ x: 2, z: 2 }]; unit.pathIndex = 1;
    unit.delivery = { source: 9, destination: 19, ware: "planks", reserved: mode === "reserved" };
    updateCarrier(context, unit, .05);
    expect(unit.phase).toBe("home");
    expect(unit.delivery).toBeUndefined();
    expect(destination.incoming.planks).toBe(0);
    expect(source.output.planks).toBe(1);
    expect(source.inventory.planks).toBe(mode === "paid" ? 5 : 4);
    expect(unit.ware).toBeNull();
    expect(unit.path.length).toBeGreaterThan(0);
  }
});


it("segment clearance matches sampled shoulder and rider checks, including compressed starts", () => {
  let seed = 813;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let scenario = 0; scenario < 200; scenario++) {
    const context = fixture();
    const unit = actor(1, 8, 8);
    unit.mounted = scenario % 2 === 0;
    unit.yaw = random() * Math.PI * 2;
    const neighbours = Array.from({ length: 6 }, (_, index) => {
      const other = actor(index + 2, 8 + random() * 4 - 2, 8 + random() * 4 - 2);
      other.mounted = index % 2 === 0;
      other.yaw = random() * Math.PI * 2;
      return other;
    });
    context.actors = [unit, ...neighbours];
    beginPersonTrafficTick(context);
    const destination = { x: 8 + random() * 2 - 1, z: 8 + random() * 2 - 1 };
    // SIM-CADENCE lever 4 (be5be99b4, d9f8c714a): the segment check samples every 0.02 tile (was
    // 0.005); the reference samples at the same spacing so the people-first loop must match exactly.
    const steps = Math.max(1, Math.ceil(Math.hypot(destination.x - 8, destination.z - 8) / .02));
    let clear = true;
    for (let step = 1; step <= steps && clear; step++) {
      const point = { x: 8 + (destination.x - 8) * step / steps,
        z: 8 + (destination.z - 8) * step / steps };
      clear = !neighbours.some(other => Math.hypot(point.x - other.x, point.z - other.z) <
        actorSeparation(unit, other) && !isSeparatingTrafficStep(unit, other, point));
    }
    expect(isTrafficSegmentClear(context, unit, destination, true)).toBe(clear);
  }
});


it("retries a fish carrier after temporary people exhaust both repair attempts", () => {
  const context = fixture(), fisher = actor(1), blocker = actor(2, 2.05, 2);
  Object.assign(fisher, { job: "Fisher", ware: "fish", phase: "outputWalk" });
  context.actors.push(fisher, blocker);
  const original = fisher.path;
  // Held up by a person, not a static obstacle: no whole-route re-plan (that is static only).
  sample(context, fisher, 13, "person-blocked");
  expect(fisher.navigationRecovery?.attempts).toBe(2);
  expect(fisher.path).toBe(original);
  blocker.visible = false;
  updatePersonTraffic(context, blocker);
  sample(context, fisher, 7, "person-blocked");
  expect(fisher.path).not.toBe(original);
  expect(fisher.ware).toBe("fish");
  expect(fisher.navigationRecovery?.blocked).toBe(false);
});


it("lets an existing log carrier walk out of a newly reserved empty construction site", () => {
  const context = fixture();
  const site = { uid: 9, x: 5, z: 5, width: 6, depth: 6, construction: 0 } as SettlementBuilding;
  context.buildings.push(site);
  for (let z = 2; z < 8; z++) for (let x = 2; x < 8; x++) context.occupied[z * 16 + x] = 1;
  const unit = actor(0, 3.3, 4.5), goal = { x: 1, z: 10 };
  const path = findGroundPath(context, unit, goal);
  expect(path).not.toBeNull();
  expect(unit.ware).toBe("logs");
  expect(isNavigationEscapeClear(context, unit, { x: 3.2, z: 4.5 })).toBe(true);
  expect(isNavigationEscapeClear(context, unit, { x: 3.4, z: 4.5 })).toBe(false);
  expect(findGroundPath(context, goal, unit)).toBeNull();
  site.construction = .01;
  expect(findGroundPath(context, unit, goal)).toBeNull();
  expect(isNavigationEscapeClear(context, unit, { x: 3.2, z: 4.5 })).toBe(false);
});

it("retains only the cancelled carrier's source yard until it can return the actual cargo", () => {
  const context = fixture(), unit = actor(57, 6, 6);
  const home = { uid: 0, typeId: 0, construction: 1, x: 2, z: 5, width: 3, depth: 3,
    access: { x: 2, z: 7 }, workerApproach: { x: 2, z: 6.8 }, doorThreshold: { x: 2, z: 6 },
    inventory: {}, output: {}, input: {}, incoming: {} } as unknown as SettlementBuilding;
  const source = { ...home, uid: 32, typeId: 27, x: 6, z: 6, access: { x: 6, z: 8 },
    output: { logs: 0 } };
  context.actors.push(unit);
  context.buildings.push(home, source);
  context.options.canWorkerEnterPlot = () => true;
  unit.stockBuilding = 32;
  unit.delivery = { source: 32, destination: 0, ware: "logs" };
  unit.ware = "logs";
  expect(cancelUnreachableTask(context, unit)).toBe(true);
  expect(unit.stockBuilding).toBe(32);
  expect(unit.ware).toBe("logs");
  expect(unit.delivery).toBeUndefined();
  expect(cancelUnreachableTask(context, unit)).toBe(false);
});


it("builds a local bypass after five seconds around a stationary person without cancelling cargo", () => {
  const context = fixture(), unit = actor(1), blocker = actor(2, 4, 2);
  context.actors.push(unit, blocker);
  const original = unit.path;
  resetTrafficWork();
  sample(context, unit, 4.9, "person-blocked");
  expect(snapshotTrafficWork().groundSearches).toBe(0);
  expect(unit.path).toBe(original);
  sample(context, unit, .2, "person-blocked");
  expect(unit.path).not.toBe(original);
  expect(unit.path.some(point => Math.abs(point.z - 2) > .2)).toBe(true);
  expect(unit.ware).toBe("logs");
  expect(unit.phase).toBe("deliver");
  expect(unit.navigationRecovery?.blocked).toBe(false);
});

it("bounds crowded repair work globally even when 128 walkers all request bypasses", () => {
  const context = fixture();
  const units = Array.from({ length: 128 }, (_, uid) => actor(uid));
  context.actors.push(...units);
  resetTrafficWork();
  for (let tick = 0; tick < 200; tick++) {
    beginNavigationRepairTick(context, .05);
    for (const unit of units) {
      beginActorMovement(unit); recordMovementOutcome(unit, "person-blocked");
      updateNavigationRecovery(context, unit, .05, path => { unit.path = path; }, () => false);
    }
  }
  const metrics = navigationRepairMetrics(context), work = snapshotTrafficWork();
  expect(metrics.grants).toBeGreaterThan(0);
  expect(metrics.deferred).toBeGreaterThan(0);
  expect(metrics.grants).toBeLessThanOrEqual(42); // Initial 2, then 2/.25s after the 5-second threshold.
  expect(work.groundSearches).toBeLessThanOrEqual(metrics.grants * 4);
  expect(work.groundVisits).toBeLessThanOrEqual(metrics.grants * 4 * 512);
  expect(units.every(unit => unit.ware === "logs" && !unit.navigationRecovery?.blocked)).toBe(true);
});

it("lets blocked tree/stone approach retries reach the shared recovery clock instead of hiding the stall", () => {
  const context = fixture(), unit = actor(1, 2, 2);
  Object.assign(unit, { job: "Woodcutter", phase: "outbound", ware: null, tool: "axe",
    target: { id: 0, kind: "tree", x: 8, z: 2 } });
  context.actors.push(unit);
  for (let z = 0; z < 6; z++) for (let x = 6; x < 11; x++) context.options.world.walkCost[z * 16 + x] = 0;
  let cancelled = 0;
  for (let tick = 0; tick < 110 && !cancelled; tick++) {
    beginNavigationRepairTick(context, .05); beginActorMovement(unit);
    expect(recoverResourceApproach(context, unit, .05)).toBe(true);
    updateNavigationRecovery(context, unit, .05, () => { throw new Error("sealed resource route"); }, () => { cancelled++; return true; });
  }
  expect(cancelled).toBe(1);
  expect(unit.tool).toBe("axe");
  expect(unit.ware).toBeNull();
});

describe("whole-route re-plan of a stuck walker (owner 2026-11-07)", () => {
  /** A wall across the map with one far gap: no 512-visit local repair gets round it. */
  const walledFixture = () => {
    const context = fixture();
    for (let z = 0; z < 14; z++) context.options.world.walkCost[z * 16 + 5] = 0;
    const walker = actor(1, 2, 2);
    Object.assign(walker, { job: "Soldier", phase: "retire", ware: null });
    context.actors.push(walker);
    return { context, walker };
  };
  const sampleRepairs = (context: SettlementContext, unit: SettlementActor, seconds: number,
    outcome: Parameters<typeof recordMovementOutcome>[1] = "static-blocked") => {
    let repairs = 0;
    for (let step = 0; step < seconds * 20; step++) {
      beginNavigationRepairTick(context, .05);
      beginActorMovement(unit);
      recordMovementOutcome(unit, outcome);
      updateNavigationRecovery(context, unit, .05, path => {
        repairs++; unit.path = path; unit.pathIndex = 0;
      }, () => false);
    }
    return repairs;
  };

  it("re-plans the whole way once, to the same destination, after two failed local repairs", () => {
    const { context, walker } = walledFixture();
    const destination = walker.path.at(-1)!;

    expect(sampleRepairs(context, walker, 13)).toBe(1);

    expect(walker.path.at(-1)).toBe(destination);
    expect(walker.path.length).toBeGreaterThan(1);
    // Round the wall through its gap, never across it.
    expect(walker.path.every(point => point.x < 5 || point.x >= 6 || point.z >= 14)).toBe(true);
    expect(walker.path.some(point => point.z >= 14)).toBe(true);
    expect(walker).toMatchObject({ phase: "retire", ware: null });
    expect(walker.navigationRecovery).toMatchObject({ attempts: 2, blocked: false, replanned: true });
    expect(saveNavigationRecovery(walker)?.replanned).toBe(true);
    // Stuck behind the wall again on the same task: local repairs only, never a second re-plan.
    walker.path = [destination];
    walker.pathIndex = 0;
    expect(sampleRepairs(context, walker, 40)).toBe(0);
    expect(walker.navigationRecovery?.replanned).toBe(true);
  });

  it("re-plans again only after a navigation revision", () => {
    const { context, walker } = walledFixture();
    expect(sampleRepairs(context, walker, 13)).toBe(1);
    context.options.world.buildRevision = 1;
    sampleRepairs(context, walker, .5);
    expect(walker.navigationRecovery?.replanned).toBeUndefined();
  });

  it.each(["person-blocked", "yield-wait", "invalid-route"] as const)(
    "never re-plans a walker that is %s rather than statically blocked", outcome => {
      const { context, walker } = walledFixture();
      const original = walker.path;
      expect(sampleRepairs(context, walker, 40, outcome)).toBe(0);
      expect(walker.path).toBe(original);
      expect(walker.navigationRecovery?.replanned).toBeUndefined();
    });

  it("leaves a rider to its own mounted repairs", () => {
    const { context, walker } = walledFixture();
    walker.mounted = true;
    const original = walker.path;
    expect(sampleRepairs(context, walker, 40)).toBe(0);
    expect(walker.path).toBe(original);
  });
});
