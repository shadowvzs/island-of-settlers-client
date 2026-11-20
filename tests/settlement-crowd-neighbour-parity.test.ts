import { describe, expect, it } from "vitest";

import { DMath } from "../src/shared/math/deterministic-math";
import { createCrowdPointBlocker } from "../src/shared/settlement/settlement-crowd-snapshot";
import { isNearDoorLane } from "../src/shared/settlement/settlement-entrance";
import { distanceToSegment } from "../src/shared/settlement/settlement-geometry";
import {
  separateIdlePeople, separateIdlePeoplePairwise
} from "../src/shared/settlement/settlement-idle-separation";
import { hasStorageDoorLanes, storageDoorLaneDistance } from "../src/shared/settlement/settlement-storage-door-lanes";
import { actorSeparation, isTrafficPassThrough } from "../src/shared/settlement/settlement-traffic";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { createTrafficWorld } from "./helpers/traffic-scenario";

/** A10: the neighbour-grid versions must give bit-identical answers to the full scans they replace. */
const createRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const idlePerson = (uid: number, x: number, z: number, phase = "idle") => ({
  action: "idle", building: 0, home: 0, job: "Carrier", path: [], pathIndex: 0, phase, uid, visible: true, x, z
}) as unknown as SettlementActor;

/** Dense clumps (with exact duplicates) next to blocked cells, so pushes chain and some are refused. */
const createIdleCrowd = (seed: number, people: number) => {
  const { context, occupied, size } = createTrafficWorld(32);
  const random = createRandom(seed);
  for (let cell = 0; cell < 40; cell++) occupied[Math.floor(random() * size * size)] = 1;
  const clumps = [{ x: 8, z: 8 }, { x: 16.5, z: 12 }, { x: 22, z: 22 }];
  for (let index = 0; index < people; index++) {
    const clump = clumps[index % clumps.length]!;
    const duplicate = index % 17 === 0 && index > 0;
    const previous = context.actors.at(-1);
    const x = duplicate && previous ? previous.x : clump.x + (random() - .5) * 2.4;
    const z = duplicate && previous ? previous.z : clump.z + (random() - .5) * 2.4;
    context.actors.push(idlePerson(index + 1, x, z, index % 11 === 0 ? "militaryField" : "idle"));
  }
  return context;
};

const positions = (context: SettlementContext) => context.actors.map(actor => [actor.x, actor.z]);

describe("idle separation through the neighbour grid", () => {
  it.each([[1, 120], [7, 260], [42, 400]])("matches the pairwise pass bit for bit (seed %i, %i people)",
    (seed, people) => {
      const grid = createIdleCrowd(seed, people);
      const pairwise = createIdleCrowd(seed, people);
      for (let pass = 0; pass < 6; pass++) {
        separateIdlePeople(grid);
        separateIdlePeoplePairwise(pairwise);
        expect(positions(grid)).toEqual(positions(pairwise));
      }
      expect(positions(grid)).not.toEqual(positions(createIdleCrowd(seed, people)));
    });
});

/** The door-lane test as it was before the box rejection. */
const nearDoorLaneByDistance = (building: SettlementBuilding, point: { x: number; z: number }, clearance: number) =>
  distanceToSegment(point, building.doorThreshold, building.workerApproach) < clearance ||
  distanceToSegment(point, building.workerApproach, building.access) < clearance ||
  (hasStorageDoorLanes(building) && (storageDoorLaneDistance(building, point, "in") < clearance ||
    storageDoorLaneDistance(building, point, "out") < clearance));

const doorBuilding = (typeId: number, rotation: number) => {
  const angle = rotation * Math.PI / 2, x = 12, z = 12;
  const along = (distance: number) => ({ x: x + DMath.sin(angle) * distance, z: z + DMath.cos(angle) * distance });
  return { access: along(3.5), construction: 1, doorThreshold: along(1.3), hasDoor: true, rotation, typeId,
    workerApproach: along(3.2), x, z } as unknown as SettlementBuilding;
};

describe("door lane box rejection", () => {
  it("answers exactly like the segment distances", () => {
    const random = createRandom(5);
    for (const typeId of [0, 29, 7]) for (const rotation of [0, 1, 2, 3]) {
      const building = doorBuilding(typeId, rotation);
      for (let sample = 0; sample < 4000; sample++) {
        const point = { x: 12 + (random() - .5) * 14, z: 12 + (random() - .5) * 14 };
        for (const clearance of [.17, .45, 2.5])
          expect(isNearDoorLane(building, point, clearance)).toBe(nearDoorLaneByDistance(building, point, clearance));
      }
    }
  });
});

const CROWD_JOBS = ["Carrier", "Carrier", "Carrier", "Mount", "Soldier"];
const crowdMember = (random: () => number, uid: number) => {
  const kind = uid % CROWD_JOBS.length;
  return {
    action: "walk", building: 0, home: 0, job: CROWD_JOBS[kind],
    mounted: kind === 2, path: [], pathIndex: 0, phase: "deliver", uid, visible: uid % 7 !== 0,
    x: 10 + random() * 6, yaw: random() * Math.PI * 2, z: 10 + random() * 6
  } as unknown as SettlementActor;
};

describe("crowd point blocker", () => {
  it("answers exactly like the full actor scan", () => {
    const { context } = createTrafficWorld(32);
    const random = createRandom(9);
    for (let uid = 1; uid <= 220; uid++) context.actors.push(crowdMember(random, uid));
    for (const actor of context.actors.slice(0, 12)) {
      const blocked = createCrowdPointBlocker(context, actor, .02);
      for (let sample = 0; sample < 600; sample++) {
        const point = { x: 9 + random() * 8, z: 9 + random() * 8 };
        const scanned = context.actors.some(other => other !== actor && other.visible &&
          !isTrafficPassThrough(context, actor, other) &&
          DMath.hypot(other.x - point.x, other.z - point.z) < actorSeparation(actor, other) + .02);
        expect(blocked(point)).toBe(scanned);
      }
    }
  });
});
