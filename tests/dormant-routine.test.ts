import { describe, expect, it } from "vitest";

import { TICK_SECONDS } from "../../island-of-settlers-shared/src/time/constants";
import { createIslandNav } from "../src/render-common/wildlife/nav/island-nav";
import { isStandFree } from "../src/render-common/wildlife/nav/nav-query";
import {
  anchorRoutine,
  createDormantPool,
  DORMANT_FADE_TICKS,
  dormantAge,
  dormantAppear,
  type DormantPool,
  dormantRest,
  evaluateDormantPose,
  HOME_RANGE,
  MAX_WAYPOINTS,
  restoreRoutine,
  routineWaypoints
} from "../src/render-common/wildlife/sim/dormant-routine";
import { ANIMAL_STATE, SPECIES } from "../src/render-common/wildlife/wildlife-species";
import { huntingWorld } from "./helpers/hunting-world";

const ANCHOR = 400;
const SLOT = 1;

const anchorDeer = (dormant: DormantPool, seed: number, species: number = SPECIES.deer) => {
  const world = huntingWorld();
  const nav = createIslandNav(world, []);
  anchorRoutine(dormant, SLOT, {
    age: 0.3, anchorTick: ANCHOR, appear: 1, heading: 0.4, homeX: 30, homeZ: 30, nav, routineSeed: seed,
    species, speedFactor: 1, x: 30, z: 30
  });
  return nav;
};

const visitCount = (waypoints: number) => (waypoints < 2 ? 1 : 2 * waypoints - 2);
const waypointOfVisit = (waypoints: number, visit: number) =>
  visit < waypoints ? visit : 2 * waypoints - 2 - visit;

/**
 * Reference integrator: walks the schedule one tick at a time (dwell countdown, then one leg
 * tick after another) from the anchor to `tick` and returns where it stands.
 */
const steppedPosition = (dormant: DormantPool, tick: number) => {
  const waypoints = dormant.waypointCount[SLOT]!;
  const visits = visitCount(waypoints);
  const point = (index: number) => ({
    x: dormant.waypoints[(SLOT * MAX_WAYPOINTS + index) * 2]!,
    z: dormant.waypoints[(SLOT * MAX_WAYPOINTS + index) * 2 + 1]!
  });
  let visit = 0;
  let dwellLeft = dormant.dwellTicks[SLOT * (2 * MAX_WAYPOINTS - 2)]!;
  let legElapsed = -1;
  let legTicks = 0;
  for (let step = ANCHOR; step < tick; step += 1) {
    if (dwellLeft > 0) {
      dwellLeft -= 1;
      if (dwellLeft === 0 && waypoints > 1) {
        const from = waypointOfVisit(waypoints, visit);
        const to = waypointOfVisit(waypoints, (visit + 1) % visits);
        legTicks = dormant.legTicks[SLOT * (MAX_WAYPOINTS - 1) + Math.min(from, to)]!;
        legElapsed = 0;
      } else if (dwellLeft === 0) {
        dwellLeft = dormant.dwellTicks[SLOT * (2 * MAX_WAYPOINTS - 2)]!;
      }
      continue;
    }
    legElapsed += 1;
    if (legElapsed < legTicks) continue;
    visit = (visit + 1) % visits;
    dwellLeft = dormant.dwellTicks[SLOT * (2 * MAX_WAYPOINTS - 2) + visit]!;
    legElapsed = -1;
  }
  const at = point(waypointOfVisit(waypoints, visit));
  if (legElapsed < 0) return at;
  const to = point(waypointOfVisit(waypoints, (visit + 1) % visits));
  const fraction = legElapsed / legTicks;
  return { x: at.x + (to.x - at.x) * fraction, z: at.z + (to.z - at.z) * fraction };
};

describe("dormant closed-form routines", () => {
  it("anchors validated waypoints inside the home range with a whole-tick schedule", () => {
    const dormant = createDormantPool(4);
    const nav = anchorDeer(dormant, 7);
    const count = dormant.waypointCount[SLOT]!;
    expect(count).toBeGreaterThan(1);
    expect(count).toBeLessThanOrEqual(MAX_WAYPOINTS);
    const flat = routineWaypoints(dormant, SLOT);
    expect(flat.length).toBe(count * 2);
    expect(flat[0]).toBe(30);
    expect(flat[1]).toBe(30);
    for (let index = 0; index < count; index += 1) {
      const x = flat[index * 2]!, z = flat[index * 2 + 1]!;
      expect(Math.hypot(x - 30, z - 30)).toBeLessThanOrEqual(HOME_RANGE + 1e-3);
      expect(isStandFree(nav, SPECIES.deer, x, z)).toBe(true);
    }
    expect(dormant.cycleTicks[SLOT]).toBeGreaterThan(0);
    for (let visit = 0; visit < 2 * count - 2; visit += 1) {
      const dwell = dormant.dwellTicks[SLOT * (2 * MAX_WAYPOINTS - 2) + visit]!;
      expect(Number.isInteger(dwell)).toBe(true);
      expect(dwell).toBeGreaterThanOrEqual(4 / TICK_SECONDS);
    }
    for (let leg = 0; leg < count - 1; leg += 1) {
      expect(dormant.legTicks[SLOT * (MAX_WAYPOINTS - 1) + leg]).toBeGreaterThanOrEqual(1);
    }
  });

  it("evaluates the same position as stepping the schedule tick by tick, and repeats each cycle", () => {
    const dormant = createDormantPool(4);
    anchorDeer(dormant, 11);
    const cycle = dormant.cycleTicks[SLOT]!;
    let walked = 0;
    for (let tick = ANCHOR; tick < ANCHOR + cycle * 2 + 7; tick += 1) {
      const pose = evaluateDormantPose(dormant, SLOT, tick);
      const reference = steppedPosition(dormant, tick);
      expect(pose.x).toBeCloseTo(reference.x, 3);
      expect(pose.z).toBeCloseTo(reference.z, 3);
      if (pose.walking) walked += 1;
      const later = evaluateDormantPose(dormant, SLOT, tick + cycle);
      expect(later.x).toBe(pose.x);
      expect(later.z).toBe(pose.z);
    }
    expect(walked).toBeGreaterThan(0);
    const start = evaluateDormantPose(dormant, SLOT, ANCHOR);
    expect(start.x).toBe(30);
    expect(start.z).toBe(30);
    expect(start.walking).toBe(false);
    expect(start.state).toBe(ANIMAL_STATE.graze);
  });

  it("interpolates fractional ticks along a leg and keeps the walking speed", () => {
    const dormant = createDormantPool(4);
    anchorDeer(dormant, 11);
    const cycle = dormant.cycleTicks[SLOT]!;
    let checked = 0;
    for (let tick = ANCHOR; tick < ANCHOR + cycle; tick += 1) {
      const before = evaluateDormantPose(dormant, SLOT, tick);
      if (!before.walking || before.remainingTicks < 2) continue;
      const beforeX = before.x, beforeZ = before.z, speed = before.speed;
      const after = evaluateDormantPose(dormant, SLOT, tick + 1);
      const afterX = after.x, afterZ = after.z;
      const half = evaluateDormantPose(dormant, SLOT, tick + 0.5);
      expect(half.x).toBeCloseTo((beforeX + afterX) / 2, 4);
      expect(half.z).toBeCloseTo((beforeZ + afterZ) / 2, 4);
      expect(Math.hypot(afterX - beforeX, afterZ - beforeZ)).toBeCloseTo(speed * TICK_SECONDS, 3);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("ages and fades in by the closed form", () => {
    const dormant = createDormantPool(4);
    anchorDeer(dormant, 3);
    expect(dormantAge(dormant, SLOT, SPECIES.deer, ANCHOR)).toBeCloseTo(0.3, 6);
    const later = dormantAge(dormant, SLOT, SPECIES.deer, ANCHOR + 20 * 60);
    expect(later).toBeGreaterThan(0.3);
    expect(dormantAge(dormant, SLOT, SPECIES.deer, ANCHOR + 20 * 60 * 60 * 24)).toBe(1);
    dormant.appearAtAnchor[SLOT] = 0;
    expect(dormantAppear(dormant, SLOT, ANCHOR)).toBe(0);
    expect(dormantAppear(dormant, SLOT, ANCHOR + DORMANT_FADE_TICKS / 2)).toBeCloseTo(0.5, 6);
    expect(dormantAppear(dormant, SLOT, ANCHOR + DORMANT_FADE_TICKS * 3)).toBe(1);
  });

  it("rises an animal bedded at the anchor before its routine ever walks (no sliding while lying)", () => {
    for (const species of [SPECIES.rabbit, SPECIES.deer, SPECIES.elk]) {
      for (let seed = 1; seed <= 12; seed += 1) {
        const dormant = createDormantPool(4);
        anchorDeer(dormant, seed, species);
        dormant.restAtAnchor[SLOT] = 1;
        expect(dormantRest(dormant, SLOT, species, ANCHOR)).toBe(1);
        const cycle = dormant.cycleTicks[SLOT]!;
        for (let tick = ANCHOR; tick <= ANCHOR + cycle * 2; tick += 1) {
          if (!evaluateDormantPose(dormant, SLOT, tick).walking) continue;
          expect(dormantRest(dormant, SLOT, species, tick)).toBe(0);
        }
        expect(dormantRest(dormant, SLOT, species, ANCHOR + cycle)).toBe(0);
      }
    }
  });

  it("restores the saved anchor and waypoints to the identical schedule and poses", () => {
    const dormant = createDormantPool(4);
    anchorDeer(dormant, 21);
    const saved = {
      age: dormant.ageAtAnchor[SLOT]!, anchorTick: dormant.anchorTick[SLOT]!,
      appear: dormant.appearAtAnchor[SLOT]!, heading: dormant.anchorHeading[SLOT]!,
      routineSeed: dormant.routineSeed[SLOT]!,
      waypoints: Array.from(routineWaypoints(dormant, SLOT))
    };
    const restored = createDormantPool(4);
    restoreRoutine(restored, SLOT, saved, SPECIES.deer, 1);
    expect(restored.cycleTicks[SLOT]).toBe(dormant.cycleTicks[SLOT]);
    expect([...restored.legTicks]).toEqual([...dormant.legTicks]);
    expect([...restored.dwellTicks]).toEqual([...dormant.dwellTicks]);
    for (let tick = ANCHOR; tick < ANCHOR + 300; tick += 7) {
      const original = evaluateDormantPose(dormant, SLOT, tick);
      const x = original.x, z = original.z, heading = original.heading;
      const copy = evaluateDormantPose(restored, SLOT, tick);
      expect(copy.x).toBe(x);
      expect(copy.z).toBe(z);
      expect(copy.heading).toBe(heading);
    }
  });

  it("stands and grazes when no valid leg exists", () => {
    const dormant = createDormantPool(4);
    const world = huntingWorld();
    const nav = createIslandNav(world, []);
    nav.isExcluded = (x, z) => Math.hypot(x - 30, z - 30) > 0.3;
    anchorRoutine(dormant, SLOT, {
      age: 1, anchorTick: ANCHOR, appear: 1, heading: -1.2, homeX: 30, homeZ: 30, nav, routineSeed: 5,
      species: SPECIES.rabbit, speedFactor: 1, x: 30, z: 30
    });
    expect(dormant.waypointCount[SLOT]).toBe(1);
    const pose = evaluateDormantPose(dormant, SLOT, ANCHOR + 12345);
    expect(pose.x).toBe(30);
    expect(pose.walking).toBe(false);
    expect(pose.speed).toBe(0);
    expect(pose.heading).toBeCloseTo(-1.2, 6);
  });

  it("turns smoothly from the anchor heading and from each arriving leg, never snapping", () => {
    const dormant = createDormantPool(4);
    anchorDeer(dormant, 11);
    expect(evaluateDormantPose(dormant, SLOT, ANCHOR).heading).toBeCloseTo(0.4, 6);
    const cycle = dormant.cycleTicks[SLOT]!;
    let previous = evaluateDormantPose(dormant, SLOT, ANCHOR).heading;
    for (let tick = ANCHOR + 1; tick < ANCHOR + cycle * 2; tick += 1) {
      const heading = evaluateDormantPose(dormant, SLOT, tick).heading;
      const turn = Math.abs(Math.atan2(Math.sin(heading - previous), Math.cos(heading - previous)));
      expect(turn).toBeLessThan(0.5);
      previous = heading;
    }
  });
});
