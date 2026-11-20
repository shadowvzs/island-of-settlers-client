import { describe, expect, it } from "vitest";

import { DMath } from "../src/shared/math/deterministic-math";
import { isOwnDoorLane, isOwnStockCourtyard } from "../src/shared/settlement/settlement-entrance";
import { isMountedNavigationClear, isNavigationClear } from "../src/shared/settlement/settlement-navigation";
import {
  beginPersonTrafficTick, clearPersonTraffic, nearbyTrafficActors, nearbyTrafficActorsWhere
} from "../src/shared/settlement/settlement-person-index";
import {
  actorSeparation, chooseYieldTarget, isQueueSpotTaken, isTrafficPassThrough, isTrafficSegmentClear
} from "../src/shared/settlement/settlement-traffic";
import type { SettlementActor, SettlementContext, SettlementPoint } from "../src/shared/settlement/settlement-types";
import { createTrafficWorld } from "./helpers/traffic-scenario";

/** A10b: the people-first segment check and the shared shoulder read against the pre-A10b code. */
const createRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

/** The interleaved per-sample loop as it was before A10b, at the SIM-CADENCE 0.02 tile spacing. */
const referenceSegmentClear = (context: SettlementContext, actor: SettlementActor, destination: SettlementPoint,
  checkPeople = false) => {
  const distance = DMath.hypot(destination.x - actor.x, destination.z - actor.z);
  const steps = Math.max(1, Math.ceil(distance / 0.02));
  const people = checkPeople ? nearbyTrafficActors(context, { x: (actor.x + destination.x) / 2,
    z: (actor.z + destination.z) / 2 }, distance / 2 + (actor.mounted ? 2.1 : 1.25)) : [];
  const clearances = people.filter(other => other !== actor && other.visible &&
    !isTrafficPassThrough(context, actor, other)).map(other => {
    const separation = actorSeparation(actor, other);
    const start = DMath.hypot(actor.x - other.x, actor.z - other.z);
    return { other, separationSquared: separation * separation,
      separatingSquared: start < separation ? (start + 1e-8) * (start + 1e-8) : Infinity };
  });
  for (let index = 1; index <= steps; index++) {
    const fraction = index / steps;
    const point = { x: actor.x + (destination.x - actor.x) * fraction,
      z: actor.z + (destination.z - actor.z) * fraction };
    if (actor.mounted && !isMountedNavigationClear(context, point)) return false;
    if (!isNavigationClear(context, point, isOwnDoorLane(context, actor, point) ||
      isOwnStockCourtyard(context, actor, point))) return false;
    for (const { other, separatingSquared, separationSquared } of clearances) {
      const dx = point.x - other.x, dz = point.z - other.z;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared < separationSquared && distanceSquared <= separatingSquared) return false;
    }
  }
  return true;
};

/** The shoulder choice as it was before A10b (no `allowed` filter in these cases). */
const referenceYieldTarget = (context: SettlementContext, actor: SettlementActor, target: SettlementPoint) => {
  const dx = target.x - actor.x, dz = target.z - actor.z;
  const length = DMath.hypot(dx, dz);
  if (!length) return null;
  const forwardX = dx / length, forwardZ = dz / length;
  for (const distance of [0.24, 0.34, 0.4, 0.65, 0.85]) for (const side of [1, -1])
    for (const forward of [0.25, 0, -0.25]) {
      const point = { x: actor.x - forwardZ * distance * side + forwardX * forward,
        z: actor.z + forwardX * distance * side + forwardZ * forward };
      if (!isQueueSpotTaken(context, actor, point) && referenceSegmentClear(context, actor, point, true)) return point;
    }
  return null;
};

const JOBS = ["Carrier", "Carrier", "Carrier", "Mount", "Soldier", "Carrier"];
const crowdMember = (random: () => number, uid: number, centre: number) => {
  const kind = uid % JOBS.length;
  const actor = {
    action: uid % 3 ? "walk" : "idle", building: 0, home: 0, job: JOBS[kind], mounted: kind === 5,
    path: [], pathIndex: 0, phase: uid % 4 ? "deliver" : "militaryField", uid, visible: uid % 9 !== 0,
    x: centre + (random() - .5) * 5, yaw: random() * Math.PI * 2, z: centre + (random() - .5) * 5
  } as unknown as SettlementActor;
  if (uid % 6 === 0) actor.queueTarget = { x: actor.x + (random() - .5), z: actor.z + (random() - .5) };
  return actor;
};

/** A crowd beside blocked cells; `stale` moves people after indexing, so filed cells differ from live ones. */
const createCrowd = (seed: number, people: number, index: "fresh" | "none" | "stale") => {
  const { context, occupied, size } = createTrafficWorld(32);
  const random = createRandom(seed);
  for (let cell = 0; cell < 60; cell++) {
    const x = 11 + Math.floor(random() * 10), z = 11 + Math.floor(random() * 10);
    occupied[z * size + x] = 1;
  }
  for (let uid = 1; uid <= people; uid++) context.actors.push(crowdMember(random, uid, 16));
  if (index === "none") clearPersonTraffic(context);
  else beginPersonTrafficTick(context);
  if (index === "stale") for (const actor of context.actors.slice(0, people / 3)) {
    actor.x += (random() - .5) * 1.4; actor.z += (random() - .5) * 1.4;
  }
  return { context, random };
};

describe("people-first traffic segment check", () => {
  it.each([[3, 90, "fresh"], [11, 220, "stale"], [17, 120, "none"]] as const)(
    "answers like the interleaved loop (seed %i, %i people, %s index)", (seed, people, index) => {
      const { context, random } = createCrowd(seed, people, index);
      let clear = 0, total = 0;
      for (const actor of context.actors.slice(0, 40)) for (let sample = 0; sample < 40; sample++) {
        const angle = random() * Math.PI * 2, length = random() * 1.6;
        const point = { x: actor.x + DMath.cos(angle) * length, z: actor.z + DMath.sin(angle) * length };
        for (const people of [false, true]) {
          const expected = referenceSegmentClear(context, actor, point, people);
          expect(isTrafficSegmentClear(context, actor, point, people)).toBe(expected);
          clear += Number(expected); total++;
        }
      }
      // Both answers occur often enough for the comparison to mean something.
      expect(clear).toBeGreaterThan(total * .1);
      expect(clear).toBeLessThan(total * .9);
    });
});

describe("shoulder choice with one people read", () => {
  it.each([[5, 160, "fresh"], [23, 260, "stale"], [29, 100, "none"]] as const)(
    "picks the same shoulder (seed %i, %i people, %s index)", (seed, people, index) => {
      const { context, random } = createCrowd(seed, people, index);
      let found = 0;
      for (const actor of context.actors.slice(0, 60)) {
        const target = { x: actor.x + (random() - .5) * 4, z: actor.z + (random() - .5) * 4 };
        const expected = referenceYieldTarget(context, actor, target);
        expect(chooseYieldTarget(context, actor, actor, target, true)).toEqual(expected);
        found += Number(expected !== null);
      }
      expect(found).toBeGreaterThan(5);
      expect(found).toBeLessThan(60);
    });
});

describe("kept-neighbour order", () => {
  it("equals the filtered full sort", () => {
    const { context, random } = createCrowd(31, 240, "stale");
    for (const actor of context.actors.slice(0, 80)) {
      const radius = .5 + random() * 2;
      const keep = (other: SettlementActor) => other !== actor && other.visible &&
        DMath.hypot(other.x - actor.x, other.z - actor.z) < radius * .8;
      expect(nearbyTrafficActorsWhere(context, actor, radius, keep).map(other => other.uid))
        .toEqual(nearbyTrafficActors(context, actor, radius).filter(keep).map(other => other.uid));
    }
  });
});
