import { expect, it } from "vitest";

import { CARRIER_WALK_SPEED } from "../src/shared/balance/economy";
import { compactRoadSegments, createRoadBend } from "../src/shared/settlement/road-curves";
import { createRoadNetwork, ROAD_WIDTH } from "../src/shared/settlement/road-network";
import { moveActor, setActorPath } from "../src/shared/settlement/settlement-paths";
import {
  isPreparedRoadTravel,
  prepareRoadTravel,
  restorePreparedRoadTravel
} from "../src/shared/settlement/settlement-road-travel";
import { actorSeparation, trafficTarget } from "../src/shared/settlement/settlement-traffic";
import { resetTrafficWork, snapshotTrafficWork } from "../src/shared/settlement/settlement-traffic-counters";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";

const fixture = () => {
  const size = 20;
  const world = {
    cellsX: size,
    cellsZ: size,
    heights: new Float32Array((size + 1) ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10),
    blocking: new Uint8Array(size ** 2),
    props: { count: 0 }
  };
  const occupied = new Uint8Array(size ** 2);
  const roads = createRoadNetwork(world, {
    isBlocked: (x, z) => occupied[Math.floor(z) * size + Math.floor(x)] === 1
  });
  const context = {
    options: { world, roads },
    occupied,
    actors: [],
    buildings: []
  } as unknown as SettlementContext;
  const actor = (uid: number, x: number, z: number, toX: number, toZ: number) => {
    const worker = {
      uid,
      x,
      y: 0,
      z,
      yaw: 0,
      job: "Carrier",
      action: "carry",
      ware: "logs",
      visible: true,
      timer: 0,
      animationTime: 0,
      phase: "deliver",
      home: 0,
      building: 0,
      path: roads.route({ x, z }, { x: toX, z: toZ })!.points,
      pathIndex: 0
    } as SettlementActor;
    context.actors.push(worker);
    return worker;
  };
  return { actor, context, roads };
};

it("merges only collinear presentation chains, retaining intersections, tiers and doorway endpoints", () => {
  const { roads } = fixture();
  roads.addRoad({ x: 4, z: 4 }, { x: 8, z: 4 });
  roads.addRoad({ x: 8, z: 4 }, { x: 8, z: 8 });
  const graph = roads.segments();
  const compact = compactRoadSegments(graph);
  expect(graph).toHaveLength(16);
  expect(compact).toHaveLength(2);
  const bend = createRoadBend({ x: 4, z: 4 }, { x: 8, z: 4 }, { x: 8, z: 8 })!;
  expect(bend.radius).toBeCloseTo(ROAD_WIDTH / 2);
  expect(bend.start.x).toBeCloseTo(8 - ROAD_WIDTH / 2);
  expect(bend.end.z).toBeCloseTo(4 + ROAD_WIDTH / 2);
  roads.addRoad({ x: 6, z: 4 }, { x: 6, z: 6 });
  expect(compactRoadSegments(roads.segments())).toHaveLength(4);
  const doorway = {
    start: { x: 6, z: 6 },
    end: { x: 6, z: 6.5 },
    tier: "dirt" as const,
    doorway: true
  };
  expect(
    compactRoadSegments([...roads.segments(), doorway]).find((segment) => segment.doorway)?.end
  ).toEqual(doorway.end);
});

it("passes opposing loaded carriers side by side without stopping or changing final contacts", () => {
  const { actor, context, roads } = fixture();
  roads.addRoad({ x: 4, z: 4 }, { x: 8, z: 4 });
  const first = actor(0, 4, 4, 8, 4),
    second = actor(1, 8, 4, 4, 4);
  let minimum = Infinity;
  for (let tick = 0; tick < 100; tick++) {
    for (const worker of [first, second])
      if (worker.visible && moveActor(context, worker, 0.05)) worker.visible = false;
    if (first.visible && second.visible)
      minimum = Math.min(minimum, Math.hypot(first.x - second.x, first.z - second.z));
    expect(first.queueWait ?? 0).toBe(0);
    expect(second.queueWait ?? 0).toBe(0);
    expect(first.ware).toBe("logs");
    expect(second.ware).toBe("logs");
  }
  expect(minimum).toBeGreaterThan(0.35);
  expect(first.x).toBeCloseTo(8);
  expect(first.z).toBeCloseTo(4);
  expect(second.x).toBeCloseTo(4);
  expect(second.z).toBeCloseTo(4);
  expect(first.visible || second.visible).toBe(false);
});

it.each(["Carrier", "Mount"])("passes a transport horse and opposing %s without contact or sidesteps", job => {
  const { actor, context, roads } = fixture();
  roads.addRoad({ x: 3, z: 4 }, { x: 15, z: 4 });
  const horse = actor(-1, 3, 4, 15, 4), other = actor(10, 15, 4, 3, 4);
  horse.job = "Mount"; horse.phase = "horseDeliver";
  other.job = job;
  let minimum = Infinity, sidesteps = 0;
  for (let tick = 0; tick < 400; tick++) {
    for (const traveller of [horse, other]) {
      if (traveller.visible && moveActor(context, traveller, .05)) traveller.visible = false;
      if (traveller.queueTarget) sidesteps++;
    }
    if (horse.visible && other.visible)
      minimum = Math.min(minimum, Math.hypot(horse.x - other.x, horse.z - other.z));
  }
  expect(horse.visible || other.visible).toBe(false);
  expect(minimum).toBeGreaterThanOrEqual(actorSeparation(horse, other));
  expect(sidesteps).toBe(0);
  expect(horse.ware).toBe("logs"); expect(other.ware).toBe("logs");
  expect(horse.x).toBeCloseTo(15); expect(other.x).toBeCloseTo(3);
  expect(horse.z).toBeCloseTo(4); expect(other.z).toBeCloseTo(4);
});

it("preserves a saved horse route while resuming its passing offset without preparing it twice", () => {
  const { actor, context, roads } = fixture();
  roads.addRoad({ x: 3, z: 4 }, { x: 15, z: 4 });
  const horse = actor(-1, 3, 4, 15, 4);
  horse.job = "Mount"; horse.phase = "home";
  horse.pathIndex = 3; horse.x = 4;
  const path = JSON.stringify(horse.path);
  restorePreparedRoadTravel(context);
  expect(JSON.stringify(horse.path)).toBe(path);
  moveActor(context, horse, .05);
  expect(horse.z).toBeGreaterThan(4);
  expect(horse.path.at(-1)).toEqual({ x: 15, z: 4 });
  const saved = JSON.parse(JSON.stringify(horse)) as SettlementActor;
  context.actors = [saved];
  const before = JSON.stringify(saved);
  restorePreparedRoadTravel(context);
  expect(isPreparedRoadTravel(saved)).toBe(false);
  expect(JSON.stringify(saved)).toBe(before);
});

it("reuses a checked horse leg while following it and invalidates it when navigation changes", () => {
  const { actor, context, roads } = fixture();
  roads.addRoad({ x: 3, z: 4 }, { x: 15, z: 4 });
  const horse = actor(-1, 15, 4, 3, 4); horse.job = "Mount";
  horse.pathIndex = 2; horse.x = 14.7;
  const point = horse.path[horse.pathIndex]!;
  resetTrafficWork();
  const target = trafficTarget(context, horse, point);
  expect(target.z).toBeCloseTo(3.69);
  const checked = snapshotTrafficWork().segmentCalls;
  horse.x += (target.x - horse.x) * .25;
  horse.z += (target.z - horse.z) * .25;
  expect(trafficTarget(context, horse, point)).toEqual(target);
  expect(snapshotTrafficWork().segmentCalls).toBe(checked);
  context.options.world.walkCost.fill(0, 3 * 20, 4 * 20);
  context.options.world.buildRevision = (context.options.world.buildRevision ?? 0) + 1;
  expect(trafficTarget(context, horse, point)).toEqual(point);
  expect(snapshotTrafficWork().segmentCalls).toBeGreaterThan(checked);
});

it("keeps repeated horse road journeys passing after the first trip and a save/load", () => {
  const { actor, context, roads } = fixture();
  const left = { x: 3, z: 4 }, right = { x: 15, z: 4 };
  roads.addRoad(left, right);
  let horse = actor(-1, 3, 4, 15, 4), carrier = actor(10, 15, 4, 3, 4);
  horse.job = "Mount";
  for (let trip = 0; trip < 8; trip++) {
    const horseGoal = trip % 2 ? left : right, carrierGoal = trip % 2 ? right : left;
    for (const [traveller, goal] of [[horse, horseGoal], [carrier, carrierGoal]] as const) {
      traveller.visible = true;
      setActorPath(traveller, roads.route(traveller, goal)!.points, "home");
    }
    for (let tick = 0; tick < 400; tick++) {
      if (trip === 3 && tick === 100) {
        [horse, carrier] = JSON.parse(JSON.stringify([horse, carrier])) as [SettlementActor, SettlementActor];
        context.actors = [horse, carrier];
        restorePreparedRoadTravel(context);
      }
      for (const traveller of [horse, carrier]) {
        if (traveller.visible && moveActor(context, traveller, .05)) traveller.visible = false;
        expect(traveller.queueTarget).toBeUndefined();
      }
      if (horse.visible && carrier.visible)
        expect(Math.hypot(horse.x - carrier.x, horse.z - carrier.z))
          .toBeGreaterThanOrEqual(actorSeparation(horse, carrier));
    }
    expect(horse.visible || carrier.visible).toBe(false);
    expect(horse.x).toBeCloseTo(horseGoal.x); expect(carrier.x).toBeCloseTo(carrierGoal.x);
  }
});

it("uses sampled rounded travel bends, keeps feet outside occupied plots and eases facing", () => {
  const { actor, context, roads } = fixture();
  context.occupied[2 * 20 + 8] = 1;
  roads.addRoad({ x: 4, z: 4 }, { x: 8, z: 4 });
  roads.addRoad({ x: 8, z: 4 }, { x: 8, z: 8 });
  const worker = actor(0, 4, 4, 8, 8);
  prepareRoadTravel(context, worker);
  expect(isPreparedRoadTravel(worker)).toBe(true);
  expect(
    worker.path.some((point, index) => index > 0 &&
      Math.abs(point.x - worker.path[index - 1]!.x) > 1e-4 &&
      Math.abs(point.z - worker.path[index - 1]!.z) > 1e-4)
  ).toBe(true);
  for (let tick = 0; tick < 260 && worker.visible; tick++) {
    const previousYaw = worker.yaw;
    const previousX = worker.x, previousZ = worker.z;
    if (moveActor(context, worker, 0.05)) worker.visible = false;
    expect(Math.abs(worker.yaw - previousYaw)).toBeLessThanOrEqual(0.300001);
    if (worker.visible) expect(Math.hypot(worker.x - previousX, worker.z - previousZ))
      .toBeGreaterThan(CARRIER_WALK_SPEED * .05 * .97);
    expect(context.occupied[Math.floor(worker.z) * 20 + Math.floor(worker.x)]).toBe(0);
  }
  expect(worker.visible).toBe(false);
  expect(worker.x).toBeCloseTo(8);
  expect(worker.z).toBeCloseTo(8);
});

it("starts avoiding a standing worker before contact, without the old yield pause", () => {
  const { context } = fixture();
  const walker = {
    uid: 0,
    x: 4,
    y: 0,
    z: 5,
    yaw: Math.PI / 2,
    job: "Builder",
    ware: null,
    visible: true,
    timer: 0,
    phase: "builderWork",
    action: "walk",
    path: [{ x: 8, z: 5 }],
    pathIndex: 0
  } as SettlementActor;
  const standing = {
    ...walker,
    uid: 1,
    x: 4.7,
    phase: "construct",
    action: "work",
    path: []
  } as SettlementActor;
  context.actors.push(walker, standing);
  moveActor(context, walker, 0.05);
  expect(walker.queueTarget).toBeDefined();
  expect(Math.hypot(walker.x - standing.x, walker.z - standing.z)).toBeGreaterThan(0.6);
  for (let tick = 0; tick < 100; tick++) {
    moveActor(context, walker, 0.05);
    expect(Math.hypot(walker.x - standing.x, walker.z - standing.z)).toBeGreaterThanOrEqual(
      actorSeparation(walker, standing)
    );
    expect(walker.queueWait ?? 0).toBe(0);
  }
  expect(walker.x).toBeCloseTo(8);
});

it("preserves both departure waypoints before entering a public passing lane", () => {
  const { actor, context, roads } = fixture();
  roads.addRoad({ x: 4, z: 4.5 }, { x: 8, z: 4.5 });
  const worker = actor(0, 4, 4.5, 8, 4.5);
  const building = { uid: 0, x: 4, z: 3, width: 2, depth: 2, construction: 1,
    doorThreshold: { x: 4, z: 3 }, workerApproach: { x: 4, z: 4.1 }, access: { x: 4, z: 4.5 } };
  context.buildings.push(building as any);
  context.occupied[3 * 20 + 4] = 1;
  worker.x = 4; worker.z = 3; worker.phase = "pickup";
  worker.path = [building.workerApproach, building.access, ...worker.path];
  prepareRoadTravel(context, worker);
  expect(worker.path[0]).toEqual(building.workerApproach);
  expect(worker.path[1]).toEqual(building.access);
  expect(worker.path.some(point => point.x > 4.5 && point.x < 7 && point.z > 4.65)).toBe(true);
  expect(worker.path.at(-1)).toEqual({ x: 8, z: 4.5 });
});

it("keeps a departing horse on its door approach until it reaches an actual public road edge", () => {
  const { actor, context, roads } = fixture();
  roads.addRoad({ x: 4, z: 4.5 }, { x: 8, z: 4.5 });
  const horse = actor(-6, 4, 4.5, 8, 4.5);
  const building = { uid: 0, x: 4, z: 3, width: 2, depth: 2, construction: 1,
    doorThreshold: { x: 4, z: 3 }, workerApproach: { x: 4, z: 4.1 }, access: { x: 4, z: 4.5 } };
  context.buildings.push(building as any);
  horse.job = "Mount"; horse.phase = "pickup"; horse.z = 4.2;
  horse.path = [building.workerApproach, building.access, ...horse.path];
  horse.pathIndex = 1;
  expect(trafficTarget(context, horse, horse.path[1]!)).toEqual(building.access);
  const publicIndex = horse.path.findIndex(point => point.x > 4.5);
  horse.pathIndex = publicIndex; horse.x = 4.5; horse.z = 4.5;
  expect(trafficTarget(context, horse, horse.path[publicIndex]!).z).toBeCloseTo(4.81);
});


it("stops a moving carrier after a cut and resumes only when roads reconnect", () => {
  const { actor, context, roads } = fixture();
  roads.addRoad({ x: 4, z: 4 }, { x: 8, z: 4 });
  const worker = actor(0, 4, 4, 8, 4);
  for (let tick = 0; tick < 10; tick++) moveActor(context, worker, .05);
  roads.removeRoad({ x: 6, z: 4 }, { x: 6.5, z: 4 });
  const stopped = { x: worker.x, z: worker.z };
  for (let tick = 0; tick < 20; tick++) expect(moveActor(context, worker, .05)).toBe(false);
  expect({ x: worker.x, z: worker.z }).toEqual(stopped);
  expect(worker.action).toBe("idle");
  expect(worker.ware).toBe("logs");
  roads.addRoad({ x: 6, z: 4 }, { x: 6.5, z: 4 });
  for (let tick = 0; tick < 100; tick++) moveActor(context, worker, .05);
  expect(worker.x).toBeCloseTo(8);
  expect(worker.z).toBeCloseTo(4);
});

it("replans a moving carrier along surviving roads after a section is removed", () => {
  const { actor, context, roads } = fixture();
  const start = { x: 4, z: 4 }, end = { x: 8, z: 4 };
  roads.addRoad(start, end);
  roads.addRoad(start, { x: 4, z: 5 });
  roads.addRoad({ x: 4, z: 5 }, { x: 8, z: 5 });
  roads.addRoad({ x: 8, z: 5 }, end);
  const worker = actor(0, 4, 4, 8, 4);
  moveActor(context, worker, .05);
  roads.removeRoad({ x: 6, z: 4 }, { x: 6.5, z: 4 });
  let maxZ = worker.z;
  for (let tick = 0; tick < 220; tick++) {
    moveActor(context, worker, .05); maxZ = Math.max(maxZ, worker.z);
  }
  expect(maxZ).toBeGreaterThan(4.7);
  expect(worker.x).toBeCloseTo(8);
  expect(worker.z).toBeCloseTo(4);
});

it("restores an already-prepared path waiting at waypoint zero without rounding it twice", () => {
  const { actor, context, roads } = fixture();
  roads.addRoad({ x: 4, z: 4 }, { x: 8, z: 4 });
  roads.addRoad({ x: 8, z: 4 }, { x: 8, z: 8 });
  const worker = actor(1, 4, 4, 8, 8);
  prepareRoadTravel(context, worker);
  expect(worker.pathIndex).toBe(0);
  expect(isPreparedRoadTravel(worker)).toBe(true);
  const saved = structuredClone(worker);
  context.actors.splice(0, context.actors.length, saved);
  restorePreparedRoadTravel(context, [saved.uid]);
  prepareRoadTravel(context, saved);
  expect(saved.path).toEqual(worker.path);
  expect(saved.pathIndex).toBe(0);
});
