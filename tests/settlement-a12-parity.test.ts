import { describe, expect, it } from "vitest";

import { ROAD_DECORATION_ITEM_DEFINITIONS } from "../../island-of-settlers-shared/src/road-decoration-items";
import type { RoadDecorationBounds } from "../src/render-common/road-decoration-clearance";
import { DMath } from "../src/shared/math/deterministic-math";
import { createRoadDecorationState, type RoadDecorationFrame } from "../src/shared/settlement/road-decoration-state";
import { withBuildingNavigationSearch } from "../src/shared/settlement/settlement-building-navigation";
import { earliestArrivals } from "../src/shared/settlement/settlement-door-traffic";
import {
  clearingStorageArrival, createClearingArrivalFilter
} from "../src/shared/settlement/settlement-entrance";
import { isNavigationClear } from "../src/shared/settlement/settlement-navigation";
import {
  beginPersonTrafficTick, firstNearbyTrafficActorWhere, nearbyTrafficActors, nearbyTrafficActorsWhere,
  updatePersonTraffic
} from "../src/shared/settlement/settlement-person-index";
import type {
  SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint
} from "../src/shared/settlement/settlement-types";
import { PROP } from "../src/shared/world/world-data";
import { createTrafficWorld } from "./helpers/traffic-scenario";

/** A12: each exact shortcut against the code it replaced. */
const createRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const doorBuilding = (uid: number, typeId: number, rotation: number) => {
  const angle = rotation * Math.PI / 2, x = 12, z = 12;
  const along = (distance: number) => ({ x: x + DMath.sin(angle) * distance, z: z + DMath.cos(angle) * distance });
  return { access: along(3.5), construction: 1, depth: 3, doorThreshold: along(1.3), hasDoor: true, rotation, typeId,
    uid, width: 3, workerApproach: along(3.2), x, z } as unknown as SettlementBuilding;
};

const PHASES = ["home", "retire", "pickup", "deliver", "enterHome", "assigned"];
/** Actors around the door, many on routes that end at the access and lead back out of the hall. */
const doorActor = (random: () => number, uid: number, building: SettlementBuilding) => {
  const { access, doorThreshold } = building;
  const along = random() * 1.4 - .2, across = (random() - .5) * .8;
  const dx = access.x - doorThreshold.x, dz = access.z - doorThreshold.z, length = DMath.hypot(dx, dz);
  const point = { x: doorThreshold.x + dx * along + (-dz / length) * across * (uid % 3 ? .3 : 3),
    z: doorThreshold.z + dz * along + (dx / length) * across * (uid % 3 ? .3 : 3) };
  const next = { x: point.x + dx / length * random() * .4, z: point.z + dz / length * random() * .4 };
  const end = uid % 5 ? access : { x: access.x + .5, z: access.z };
  const route = uid % 4 ? [next, end] : [next];
  return { delivery: { destination: building.uid, source: uid % 2 ? building.uid : 99 }, home: building.uid,
    path: route, pathIndex: 0, phase: PHASES[uid % PHASES.length], uid, visible: uid % 11 !== 0,
    x: point.x, z: point.z } as unknown as SettlementActor;
};

describe("clearing arrival prefilter", () => {
  it("never rejects an arrival the full test accepts", () => {
    const random = createRandom(7);
    let accepted = 0, rejected = 0;
    for (const typeId of [0, 29, 7]) for (const rotation of [0, 1, 2, 3]) {
      const building = doorBuilding(5, typeId, rotation);
      const context = { actors: [], buildings: [building] } as unknown as SettlementContext;
      const mayClear = createClearingArrivalFilter(context, building.uid);
      for (let uid = 1; uid <= 3000; uid++) {
        const actor = doorActor(random, uid, building);
        const clears = clearingStorageArrival(context, actor)?.uid === building.uid;
        if (clears) { expect(mayClear(actor)).toBe(true); accepted++; } else if (!mayClear(actor)) rejected++;
      }
      expect(createClearingArrivalFilter(context, 77)(doorActor(random, 1, building))).toBe(false);
    }
    // Both outcomes occur, so the comparison is meaningful.
    expect(accepted).toBeGreaterThan(200);
    expect(rejected).toBeGreaterThan(2000);
  });
});

const crowdMember = (random: () => number, uid: number) => ({
  action: "walk", building: 0, home: 0, job: "Carrier", path: [], pathIndex: 0, phase: "deliver", uid,
  visible: uid % 9 !== 0, x: 10 + random() * 6, yaw: 0, z: 10 + random() * 6
}) as unknown as SettlementActor;
/**
 * A crowd whose index has stale cells and repeated orders (an actor appended after a removal). It
 * records where and in which sequence each visible person is filed and under which order (tick-start
 * position, or the position when appended), so a reference can rebuild the index's visit order.
 */
const createIndexedCrowd = (seed: number, people: number) => {
  const { context } = createTrafficWorld(32);
  const random = createRandom(seed);
  const filed = new Map<SettlementActor, { cellX: number; cellZ: number; order: number; sequence: number }>();
  const file = (actor: SettlementActor, order: number) => {
    if (actor.visible) filed.set(actor, { cellX: Math.floor(actor.x), cellZ: Math.floor(actor.z), order,
      sequence: filed.size });
  };
  for (let uid = 1; uid <= people; uid++) context.actors.push(crowdMember(random, uid));
  beginPersonTrafficTick(context);
  context.actors.forEach(file);
  for (const actor of context.actors.slice(0, people / 4)) {
    actor.x += (random() - .5) * 1.2; actor.z += (random() - .5) * 1.2;
  }
  for (let added = 0; added < 12; added++) {
    const [removed] = context.actors.splice(Math.floor(random() * context.actors.length), 1);
    filed.delete(removed!);
    updatePersonTraffic(context, Object.assign(removed!, { visible: false }));
    const actor = crowdMember(random, people + 1 + added);
    context.actors.push(actor);
    file(actor, context.actors.length - 1);
    updatePersonTraffic(context, actor);
  }
  /** The query's people in visit order (cells z, then x; filing order in a cell), stably sorted by order. */
  const reference = (point: SettlementPoint, radius: number) => [...filed]
    .filter(([, { cellX, cellZ }]) => cellX >= Math.floor(point.x - radius) && cellX <= Math.floor(point.x + radius) &&
      cellZ >= Math.floor(point.z - radius) && cellZ <= Math.floor(point.z + radius))
    .sort(([, a], [, b]) => a.cellZ - b.cellZ || a.cellX - b.cellX || a.sequence - b.sequence)
    .sort(([, a], [, b]) => a.order - b.order).map(([actor]) => actor);
  return { context, filed, random, reference };
};

describe("person index order", () => {
  it("first kept person equals the head of the ordered kept list", () => {
    const { context, filed, random, reference } = createIndexedCrowd(13, 400);
    let found = 0, tied = 0;
    for (const actor of context.actors.slice(0, 300)) {
      const radius = .3 + random() * 4.7;
      // Half the queries keep only the people appended after removals: they all share one order.
      const keep = (other: SettlementActor) => other !== actor && (actor.uid % 2 === 0 ?
        other.uid % 4 !== 0 : filed.get(other)?.order === context.actors.length - 1);
      const expected = reference(actor, radius).filter(keep)[0];
      expect(nearbyTrafficActorsWhere(context, actor, radius, keep)[0]).toBe(expected);
      expect(firstNearbyTrafficActorWhere(context, actor, radius, keep)).toBe(expected);
      found += Number(expected !== undefined);
      tied += Number(!!expected && [...filed].some(([other, { order }]) =>
        other !== expected && keep(other) && order === filed.get(expected)!.order &&
        reference(actor, radius).includes(other)));
    }
    expect(found).toBeGreaterThan(80);
    expect(tied).toBeGreaterThan(5);
  });

  it("orders small and large neighbourhoods like the stable comparison sort", () => {
    const { context, filed, random, reference } = createIndexedCrowd(19, 400);
    const sizes = new Set<number>();
    let ties = 0;
    for (const actor of context.actors.slice(0, 120)) {
      const radius = random() * 3;
      const people = nearbyTrafficActors(context, actor, radius);
      expect(people).toEqual(reference(actor, radius));
      sizes.add(people.length > 24 ? 2 : 1);
      for (let index = 1; index < people.length; index++)
        ties += Number(filed.get(people[index]!)!.order === filed.get(people[index - 1]!)!.order);
      const keep = (other: SettlementActor) => other.uid % 3 !== 0;
      expect(nearbyTrafficActorsWhere(context, actor, radius, keep)).toEqual(people.filter(keep));
    }
    expect(sizes).toEqual(new Set([1, 2]));
    expect(ties).toBeGreaterThan(4);
  });
});

describe("earliest arrivals", () => {
  it("equals the filtered stable sort and slice", () => {
    const random = createRandom(23);
    for (let trial = 0; trial < 400; trial++) {
      const actors = Array.from({ length: 1 + Math.floor(random() * 60) }, (_, uid) => ({
        storageArrivalOrder: Math.floor(random() * 25), uid, visible: random() < .7
      }) as unknown as SettlementActor);
      const keep = (actor: SettlementActor) => actor.visible;
      const limit = 1 + Math.floor(random() * 6);
      const expected = actors.filter(keep)
        .sort((a, b) => a.storageArrivalOrder! - b.storageArrivalOrder!).slice(0, limit);
      expect(earliestArrivals(actors, keep, limit)).toEqual(expected);
    }
  });
});

const treeWorld = (seed: number) => {
  const traffic = createTrafficWorld(32);
  const random = createRandom(seed), count = 220;
  const types = new Uint8Array(count), x = new Float32Array(count), z = new Float32Array(count);
  const scale = new Float32Array(count);
  const kinds = [PROP.palmTree, PROP.largeRock, PROP.bush, PROP.broadleafTree, PROP.flowers];
  for (let index = 0; index < count; index++) {
    types[index] = kinds[index % kinds.length]!;
    x[index] = 2 + random() * 28; z[index] = 2 + random() * 28; scale[index] = .5 + random() * 6;
  }
  Object.assign(traffic.world, { props: { count, scale, types, x, z } });
  return { context: traffic.context, random };
};

describe("obstacle windows inside a navigation search", () => {
  it("answers like the per-sample window scan", () => {
    const { context, random } = treeWorld(29);
    const points = Array.from({ length: 6000 }, () => ({ x: 1 + random() * 30, z: 1 + random() * 30 }));
    let clear = 0;
    for (const radius of [0, .3, 1.1]) {
      const expected = points.map(point => isNavigationClear(context, point, false, false, radius));
      const scoped = withBuildingNavigationSearch(context, () =>
        points.map(point => isNavigationClear(context, point, false, false, radius)));
      expect(scoped).toEqual(expected);
      clear += expected.filter(Boolean).length;
    }
    expect(clear).toBeGreaterThan(points.length * .3);
    expect(clear).toBeLessThan(points.length * 2.7);
  });
});

/** The support test as it was: de-duplicated, sorted frames, then the filtered low supports. */
const referenceSupportClear = (frames: readonly RoadDecorationFrame[], near: (bounds: RoadDecorationBounds) =>
  readonly RoadDecorationFrame[], point: SettlementPoint, radius: number) => {
  if (!frames.length) return true;
  const box: RoadDecorationBounds = { max: [point.x + radius, 2.1, point.z + radius],
    min: [point.x - radius, 0, point.z - radius] };
  return near(box).every(frame => frame.volumes.filter(volume => volume.min[1] < frame.position[1] + 2.1 - 1e-6)
    .every(support => {
      const dx = Math.max(support.min[0] - point.x, 0, point.x - support.max[0]);
      const dz = Math.max(support.min[2] - point.z, 0, point.z - support.max[2]);
      return radius > 0 ? dx * dx + dz * dz >= radius * radius :
        point.x <= support.min[0] || point.x >= support.max[0] || point.z <= support.min[2] ||
        point.z >= support.max[2];
    }));
};

describe("road decoration support clearance", () => {
  it("answers like the collected frame scan", () => {
    const items = ["roadDecoration:plant-lavender-roadside-ground-0:native",
      "roadDecoration:roman-ceremonial-arch:limestone"] as const;
    for (const item of items) expect(ROAD_DECORATION_ITEM_DEFINITIONS[item]).toBeDefined();
    const environment = { heightAt: () => 2, isFree: () => true, isOwned: () => true, nation: "roman" as const,
      roads: [] };
    const owner = createRoadDecorationState(() => environment);
    const random = createRandom(31);
    for (let placed = 0; placed < 40; placed++)
      owner.place({ item: items[placed % 2]!, position: { x: 4 + random() * 24, z: 4 + random() * 24 },
        yaw: random() * 6 }, () => true);
    expect(owner.frames().length).toBeGreaterThan(10);
    let blocked = 0;
    for (let sample = 0; sample < 8000; sample++) {
      const point = { x: 3 + random() * 26, z: 3 + random() * 26 }, radius = [0, .2, .9][sample % 3]!;
      const expected = referenceSupportClear(owner.frames(), owner.framesNear, point, radius);
      expect(owner.isSupportClear(point, radius)).toBe(expected);
      blocked += Number(!expected);
    }
    expect(blocked).toBeGreaterThan(40);
  });
});
