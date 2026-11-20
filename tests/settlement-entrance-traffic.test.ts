import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CARRIER_WALK_SPEED } from "../src/shared/balance/economy";
import { beginStorageTrafficTick } from "../src/shared/settlement/settlement-door-traffic";
import {
  canEnterDoor,
  canLeaveDoor,
  isOwnDoorLane
} from "../src/shared/settlement/settlement-entrance";
import { updateCarrier } from "../src/shared/settlement/settlement-logistics";
import { moveActor } from "../src/shared/settlement/settlement-paths";
import { storageDoorLanePoint } from "../src/shared/settlement/settlement-storage-door-lanes";
import {
  actorSeparation,
  isTrafficSegmentClear
} from "../src/shared/settlement/settlement-traffic";
import type {
  SettlementActor,
  SettlementBuilding,
  SettlementContext
} from "../src/shared/settlement/settlement-types";

const actor = (uid: number, phase: string, visible = true) =>
  ({
    uid,
    phase,
    visible,
    x: 232.9091979536958,
    z: 186.22,
    y: 0,
    yaw: 0,
    home: 0,
    building: 3,
    job: "Carrier",
    action: "walk",
    ware: null,
    path: [],
    pathIndex: 0,
    timer: 0,
    animationTime: 0
  }) as SettlementActor;
const fixture = () => {
  const size = 256;
  const building = {
    uid: 0,
    x: 233,
    z: 184.5,
    width: 3,
    depth: 3,
    construction: 1,
    workerApproach: { x: 232.9091979536958, z: 186.22 },
    doorThreshold: { x: 232.9091979536958, z: 185.24965065117073 },
    access: { x: 233, z: 186.5 }
  } as SettlementBuilding;
  const occupied = new Uint8Array(size ** 2);
  for (let z = 183; z < 186; z++) for (let x = 231; x < 234; x++) occupied[z * size + x] = 1;
  const context = {
    buildings: [building],
    actors: [],
    occupied,
    options: {
      world: {
        cellsX: size,
        cellsZ: size,
        heights: new Float32Array((size + 1) ** 2),
        walkCost: new Uint8Array(size ** 2).fill(10),
        props: { count: 0 },
        buildRevision: 0
      },
      roads: { speedAt: () => 1 }
    }
  } as unknown as SettlementContext;
  return { building, context };
};
describe("serialized door traffic", () => {
  it("lets a passenger leave its harbour through the real doorway toward the ship", () => {
    const { building, context } = fixture();
    const passenger = actor(7, "navalToShip", false);
    passenger.navalOrder = 2;
    passenger.building = building.uid;
    context.actors.push(passenger);
    expect(isOwnDoorLane(context, passenger, building.doorThreshold)).toBe(true);
    expect(canLeaveDoor(context, passenger)).toBe(true);
    const entering = actor(8, "navalEnterHarbour");
    entering.building = building.uid;
    context.actors.push(entering);
    expect(canLeaveDoor(context, passenger)).toBe(false);
  });
  it("retiring builder occupies its home doorway, preventing hidden worker departures", () => {
    const { context } = fixture();
    const entering = actor(1, "enterRetire");
    const leaving = actor(0, "assigned", false);
    context.actors.push(entering, leaving);
    expect(canLeaveDoor(context, leaving)).toBe(false);
    entering.visible = false;
    expect(canLeaveDoor(context, leaving)).toBe(true);
  });
  it("queues a second arriving carrier until the first has entered", () => {
    const { building, context } = fixture();
    const first = actor(3, "enterHome");
    const second = actor(4, "home");
    context.actors.push(first, second);
    expect(canEnterDoor(context, second, building)).toBe(false);
    first.visible = false;
    expect(canEnterDoor(context, second, building)).toBe(true);
  });
  it("road delivery and return phases cannot yield into their destination's doorway", () => {
    const { context } = fixture();
    const carrier = actor(6, "deliver");
    carrier.building = 0;
    const point = { x: 232.9091979536958, z: 185.5 };
    for (const phase of ["deliver", "home", "retire", "returnWork"]) {
      carrier.phase = phase;
      expect(isOwnDoorLane(context, carrier, point)).toBe(false);
    }
    carrier.phase = "enterHome";
    expect(isOwnDoorLane(context, carrier, point)).toBe(true);
  });
  it("rejoins the exterior approach from the native stuck position instead of cutting the foundation", () => {
    const { building, context } = fixture();
    const returning = actor(3, "enterHome");
    Object.assign(returning, {
      x: 232.59494810802406,
      z: 186.0119809839638,
      path: [building.workerApproach, building.doorThreshold],
      pathIndex: 1
    });
    context.actors.push(returning);
    let arrived = false;
    for (let step = 0; step < 100; step++) {
      arrived = moveActor(context, returning, 0.05);
      if (returning.z < 186)
        expect(Math.abs(returning.x - building.doorThreshold.x)).toBeLessThan(0.17);
      if (arrived) break;
    }
    expect(arrived).toBe(true);
    expect(returning.x).toBeCloseTo(building.doorThreshold.x);
    expect(returning.z).toBeCloseTo(building.doorThreshold.z);
  });
});

describe("loaded carrier passage regressions", () => {
  it("permits the reduced personal gap while still preventing unit overlap and horse obstruction", () => {
    const { context } = fixture();
    const walker = actor(0, "deliver"),
      standing = actor(1, "rest");
    Object.assign(walker, { x: 230, z: 188 });
    Object.assign(standing, { x: 230.1, z: 188.18 });
    context.actors.push(walker, standing);
    const destination = { x: 230.2, z: 188 }, separation = actorSeparation(walker, standing);
    standing.z = 188 + separation + .02;
    expect(isTrafficSegmentClear(context, walker, destination, true)).toBe(true);
    standing.z = 188 + separation - .02;
    expect(isTrafficSegmentClear(context, walker, destination, true)).toBe(false);
    standing.z = 188.18;
    standing.job = "Mount";
    expect(isTrafficSegmentClear(context, walker, destination, true)).toBe(false);
  });
  it("reserves both parts of the passage for one loaded departure before another enters or exits", () => {
    const { building, context } = fixture();
    const loaded = actor(0, "exitLoaded");
    loaded.delivery = { source: 0, destination: 3, ware: "planks" };
    loaded.ware = "planks";
    Object.assign(loaded, {
      x: (building.workerApproach.x + building.access.x) / 2,
      z: (building.workerApproach.z + building.access.z) / 2
    });
    const entering = actor(1, "home");
    const queued = actor(2, "exitLoaded", false);
    queued.delivery = { source: 0, destination: 3, ware: "stone" };
    queued.ware = "stone";
    context.actors.push(loaded, entering, queued);
    expect(canEnterDoor(context, entering, building)).toBe(false);
    expect(canLeaveDoor(context, queued)).toBe(false);
    loaded.z = building.access.z + 0.5;
    expect(canEnterDoor(context, entering, building)).toBe(true);
    expect(canLeaveDoor(context, queued)).toBe(true);
    expect(loaded.ware).toBe("planks");
    expect(queued.ware).toBe("stone");
  });
  it("carries around a stationary worker on a routing node and deposits exactly once at the endpoint", () => {
    const { building, context } = fixture();
    Object.assign(building, {
      typeId: 0,
      incoming: { stone: 1 },
      inventory: {},
      input: {},
      output: {},
      accepts: {}
    });
    context.options.roads.route = (_from, to) => ({ points: [to], cost: 1, length: 1 });
    const worker = actor(0, "construct");
    Object.assign(worker, { x: 232, z: 188, job: "Builder" });
    const carrier = actor(1, "deliver");
    Object.assign(carrier, {
      x: 230,
      z: 188,
      ware: "stone",
      delivery: { source: 3, destination: 0, ware: "stone" },
      path: [
        { x: 231, z: 188 },
        { x: 232, z: 188 },
        { x: 233, z: 188 },
        { x: 233, z: 187 },
        building.access
      ]
    });
    context.actors.push(worker, carrier);
    let travelled = 0,
      lastX = carrier.x,
      lastZ = carrier.z;
    for (let tick = 0; tick < 600 && !(building.inventory.stone ?? 0); tick++) {
      updateCarrier(context, carrier, 0.05);
      travelled += Math.hypot(carrier.x - lastX, carrier.z - lastZ);
      lastX = carrier.x;
      lastZ = carrier.z;
      expect(Math.hypot(carrier.x - worker.x, carrier.z - worker.z)).toBeGreaterThanOrEqual(
        actorSeparation(carrier, worker)
      );
      if (carrier.ware === null)
        expect(
          Math.hypot(carrier.x - building.access.x, carrier.z - building.access.z)
        ).toBeLessThan(0.01);
    }
    expect(travelled).toBeGreaterThan(4);
    expect(building.inventory.stone).toBe(1);
    expect(building.incoming.stone).toBe(0);
    expect(carrier.ware).toBeNull();
    for (let tick = 0; tick < 100; tick++) updateCarrier(context, carrier, 0.05);
    expect(building.inventory.stone).toBe(1);
  });
});

it("keeps predictive road shoulder avoidance outside serialized own doorway passages", async () => {
  const { building, context } = fixture();
  const { anticipatedTrafficBlocker } = await import("../src/shared/settlement/settlement-traffic");
  const { isInOwnDoorPassage } = await import("../src/shared/settlement/settlement-entrance");
  const returning = actor(5, "home");
  Object.assign(returning, building.access);
  const departure = actor(0, "exitLoaded");
  departure.delivery = { source: building.uid, destination: 3, ware: "planks" };
  departure.ware = "planks";
  Object.assign(departure, {
    x: building.access.x,
    z: building.access.z + 0.4,
    path: [building.access],
    pathIndex: 0
  });
  context.actors.push(returning, departure);
  expect(isInOwnDoorPassage(context, returning)).toBe(true);
  expect(
    anticipatedTrafficBlocker(context, returning, { x: returning.x, z: returning.z + 0.5 }, 1.2)
  ).toBeNull();
  returning.x += 1;
  departure.x += 1;
  departure.path = [{ x: departure.x, z: returning.z }];
  expect(isInOwnDoorPassage(context, returning)).toBe(false);
  expect(
    anticipatedTrafficBlocker(context, returning, { x: returning.x, z: returning.z + 0.5 }, 1.2)
  ).toBe(departure);
});

it("drains five simultaneous incoming/outgoing loaded actors through the HQ gate without permanent jams", async () => {
  const { building, context } = fixture();
  const { entrancePath, exitPath } = await import("../src/shared/settlement/settlement-entrance");
  const { setActorPath } = await import("../src/shared/settlement/settlement-paths");
  const leaving = [0, 1, 2].map((uid) => {
    const unit = actor(uid, "exitLoaded", uid === 0);
    Object.assign(unit, uid === 0 ? building.workerApproach : building.doorThreshold);
    unit.ware = "planks";
    unit.delivery = { source: 0, destination: 3, ware: "planks" };
    unit.path = [
      ...exitPath(building),
      { x: building.access.x, z: building.access.z + 2 },
      { x: building.access.x + 3, z: building.access.z + 2 + uid * 0.3 }
    ];
    return unit;
  });
  const arriving = [3, 4].map((uid, index) => {
    const unit = actor(uid, "deliver");
    unit.building = 0;
    Object.assign(unit, {
      x: building.access.x + 0.3 * index,
      z: building.access.z + 0.8 + index * 0.5
    });
    unit.ware = "stone";
    unit.delivery = { source: 3, destination: 0, ware: "stone" };
    unit.path = [building.access];
    return unit;
  });
  context.actors.push(...leaving, ...arriving);
  for (let tick = 0; tick < 2000; tick++) {
    for (const unit of context.actors) {
      if (["inside", "away"].includes(unit.phase)) continue;
      if (!moveActor(context, unit, 0.05)) continue;
      if (unit.phase === "deliver") {
        if (canEnterDoor(context, unit, building))
          setActorPath(unit, entrancePath(building), "enterDelivery");
      } else if (unit.phase === "enterDelivery") {
        unit.visible = false;
        unit.ware = null;
        unit.phase = "inside";
      } else unit.phase = "away";
    }
    if (
      leaving.every((unit) => unit.phase === "away") &&
      arriving.every((unit) => unit.phase === "inside")
    )
      break;
  }
  expect(leaving.map((unit) => unit.phase)).toEqual(["away", "away", "away"]);
  expect(arriving.map((unit) => unit.phase)).toEqual(["inside", "inside"]);
  expect(leaving.every((unit) => unit.ware === "planks")).toBe(true);
});

it("physically separates three touching loaded settlers at a converged production junction without losing cargo", () => {
  const { context } = fixture();
  const units = [actor(0, "deliver"), actor(1, "deliver"), actor(2, "returnWork")];
  Object.assign(units[0]!, { x: 240, z: 190, ware: "logs", path: [{ x: 244, z: 190 }] });
  Object.assign(units[1]!, { x: 240.1, z: 190, ware: "fish", path: [{ x: 236, z: 190 }] });
  Object.assign(units[2]!, {
    x: 240.05,
    z: 190.11,
    ware: "stone",
    job: "Stonemason",
    path: [{ x: 240, z: 194 }]
  });
  context.actors.push(...units);
  const finished = new Set<number>();
  for (let tick = 0; tick < 2000; tick++)
    for (const unit of units) {
      if (finished.has(unit.uid)) continue;
      const before = { x: unit.x, z: unit.z };
      if (moveActor(context, unit, 0.05)) finished.add(unit.uid);
      expect(Math.hypot(unit.x - before.x, unit.z - before.z)).toBeLessThanOrEqual(0.061);
    }
  expect(finished.size).toBe(3);
  expect(units.map((unit) => unit.ware)).toEqual(["logs", "fish", "stone"]);
});

it("admits a ready follower within half a second through the unchanged shared doorway", () => {
  const { building, context } = fixture();
  Object.assign(building, {
    typeId: 0,
    hasDoor: true,
    incoming: { water: 2 },
    inventory: {},
    input: {},
    output: {}
  });
  const head = actor(71, "deliver");
  const next = actor(72, "deliver");
  Object.assign(head, {
    ...building.access,
    ware: "water",
    building: 0,
    delivery: { source: 3, destination: 0, ware: "water" },
    path: [building.access]
  });
  Object.assign(next, {
    x: building.access.x,
    z: building.access.z + 0.22,
    ware: "water",
    building: 0,
    delivery: { source: 3, destination: 0, ware: "water" },
    path: [building.access]
  });
  context.actors.push(head, next);
  const entries = new Map<number, number>();
  for (let tick = 0; tick < 100 && entries.size < 2; tick++) {
    beginStorageTrafficTick(context, 0.05);
    for (const crew of context.actors) {
      updateCarrier(context, crew, 0.05);
      if (crew.phase === "enterDelivery" && !entries.has(crew.uid))
        entries.set(crew.uid, tick * 0.05);
    }
    if (head.visible && next.visible)
      expect(Math.hypot(head.x - next.x, head.z - next.z)).toBeGreaterThanOrEqual(
        actorSeparation(head, next) - 1e-8
      );
  }
  expect(entries.size).toBe(2);
  expect(entries.get(next.uid)! - entries.get(head.uid)!).toBeLessThanOrEqual(0.5);
});

it("reopens a deferred arrival when the physical obstruction clears instead of waiting a whole queue round", () => {
  const { building, context } = fixture();
  Object.assign(building, { typeId: 0, hasDoor: true, incoming: { water: 1 }, inventory: {},
    input: {}, output: {} });
  const head = actor(81, "deliver");
  Object.assign(head, { x: building.access.x + 1, z: building.access.z + .7, queueWait: .05,
    building: 0, ware: "water", delivery: { source: 3, destination: 0, ware: "water" },
    path: [building.access] });
  const obstruction = actor(82, "work");
  Object.assign(obstruction, { ...storageDoorLanePoint(building, building.access, "in"), job: "Farmer" });
  const otherArrivals = Array.from({ length: 6 }, (_, index) => {
    const unit = actor(90 + index, "home");
    Object.assign(unit, { x: building.access.x + 8 + index, z: building.access.z + 8 });
    return unit;
  });
  context.actors.push(head, obstruction, ...otherArrivals);
  for (let tick = 0; tick < 90; tick++) {
    beginStorageTrafficTick(context, .05);
    updateCarrier(context, head, .05);
  }
  expect(head.phase).toBe("deliver");
  expect(head.ware).toBe("water");
  obstruction.visible = false;
  const before = { x: head.x, z: head.z };
  for (let tick = 0; tick < 12; tick++) {
    beginStorageTrafficTick(context, .05);
    updateCarrier(context, head, .05);
  }
  expect(Math.hypot(head.x - before.x, head.z - before.z)).toBeGreaterThan(.05);
  for (let tick = 0; tick < 100 && head.phase !== "inside"; tick++) {
    beginStorageTrafficTick(context, .05);
    updateCarrier(context, head, .05);
  }
  expect(head.phase).toBe("inside");
  expect(building.inventory.water).toBe(1);
});


/** Entry gaps follow the carriers' walk: half a second at the former 1.2 cells/s (BAL-01: 0.7 s). */
const READY_ENTRY_GAP = .5 * 1.2 / CARRIER_WALK_SPEED;

it.each([0, 29, 39])("streams six ready arrivals through storage %s at walk-limited gaps", typeId => {
  const { building, context } = fixture();
  Object.assign(building, { typeId, hasDoor: true, incoming: { water: 6 }, inventory: {}, input: {}, output: {} });
  const crews = Array.from({length: 6}, (_, index) => {
    const unit = actor(180 + index, "deliver");
    Object.assign(unit, {x: building.access.x, z: building.access.z + index * .28, ware: "water", building: 0,
      delivery: {source: 3, destination: 0, ware: "water"}, path: [building.access]});
    return unit;
  });
  context.actors.push(...crews);
  const entries = new Map<number, number>();
  const gaps: number[] = [];
  let latest = 0;
  for (let tick = 0; tick < 800 && entries.size < crews.length; tick++) {
    beginStorageTrafficTick(context, .05);
    for (const crew of crews) {
      updateCarrier(context, crew, .05);
      if (crew.phase === "enterDelivery" && !entries.has(crew.uid)) {
        if (entries.size) gaps.push(tick * .05 - latest);
        latest = tick * .05; entries.set(crew.uid, latest);
      }
    }
    for (let first = 0; first < crews.length; first++) {
      for (let second = first + 1; second < crews.length; second++) {
        const a = crews[first]!, b = crews[second]!;
        if (!a.visible || !b.visible) continue;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(actorSeparation(a, b) - 1e-8);
      }
    }
  }
  if (process.env.STORAGE_READY_REPORT) {
    writeFileSync(`${process.env.STORAGE_READY_REPORT}-${typeId}.json`, JSON.stringify({
      typeId, entries: [...entries.values()], gaps, maximumGap: Math.max(...gaps)
    }, null, 2));
  }
  expect(entries.size).toBe(6);
  expect(gaps.every(gap => gap <= READY_ENTRY_GAP + 1e-8)).toBe(true);
});

it.each([[1, 2], [2, 1]])("a reloaded door queue admits the saved earlier arrival first (orders %i, %i)",
  (left, right) => {
    // A fresh context has no transient door caches, exactly as after loading a save.
    const { building, context } = fixture();
    Object.assign(building, {
      typeId: 0, hasDoor: true, incoming: { water: 2 }, inventory: {}, input: {}, output: {}
    });
    const crews = [[-.5, left], [.5, right]].map(([offset, order], index) => {
      const unit = actor(200 + index, "deliver");
      Object.assign(unit, {
        building: 0, delivery: { source: 3, destination: 0, ware: "water" }, path: [building.access],
        storageArrivalBuilding: building.uid, storageArrivalOrder: order, ware: "water",
        x: building.access.x + offset!, z: building.access.z + .5
      });
      return unit;
    });
    context.actors.push(...crews);
    const entered: number[] = [];
    for (let tick = 0; tick < 400 && entered.length < 2; tick++) {
      beginStorageTrafficTick(context, .05);
      for (const crew of crews) {
        updateCarrier(context, crew, .05);
        if (crew.phase === "enterDelivery" && !entered.includes(crew.uid)) entered.push(crew.uid);
      }
    }
    const savedOrder = [...crews].sort((a, b) => a.storageArrivalOrder! - b.storageArrivalOrder!);
    expect(entered).toEqual(savedOrder.map(crew => crew.uid));
  });
