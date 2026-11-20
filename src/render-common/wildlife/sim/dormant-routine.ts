import { TICK_SECONDS } from "../../../../../island-of-settlers-shared/src/time/constants";
import { DMath } from "../../../shared/math/deterministic-math";
import { lerp } from "../../../shared/world/noise";
import { createCellRandom, createRandom } from "../../../shared/world/rng";
import { isSegmentWalkable, isStandFree, type NavWorld } from "../nav/nav-query";
import { lerpAngle } from "../nav/nav-steering";
import { ANIMAL_STATE, getSpecies } from "../wildlife-species";
import { getAgeSpeed } from "../wildlife-stages";
import { ageGrowthPerSecond } from "./animal-age";
import { getRiseRate } from "./animal-animation";

/** How far around its home (cells) a region animal roams; dormant routines stay inside it. */
export const HOME_RANGE = 8;
/** Waypoints of a routine at most (the current spot plus up to four validated stops). */
export const MAX_WAYPOINTS = 5;
/** Visits per ping-pong cycle over the waypoints (W0 .. Wn .. W1, then W0 again). */
const MAX_VISITS = 2 * MAX_WAYPOINTS - 2;
const WAYPOINT_TRIES = 6;
/** Shortest leg worth walking (cells). */
const MIN_LEG = 1;
/** Ticks a newly born dormant animal fades in over. */
export const DORMANT_FADE_TICKS = 24;
/** Ticks an arrived animal takes to turn towards its next leg (no instant snap). */
const TURN_TICKS = 20;
const TICKS_PER_SECOND = Math.round(1 / TICK_SECONDS);

/**
 * Dormant animals as a struct of arrays: the saved anchor (tick, age, appearance, seed and the
 * validated waypoints) and the schedule derived from it in whole ticks.
 */
export interface DormantPool {
  ageAtAnchor: Float32Array;
  /** Heading when the routine was anchored (the first dwell turns from it). */
  anchorHeading: Float32Array;
  anchorTick: Int32Array;
  appearAtAnchor: Float32Array;
  /** Whole-tick length of one ping-pong cycle. */
  cycleTicks: Int32Array;
  /** Dwell ticks of each visit of the cycle (MAX_VISITS per slot). */
  dwellTicks: Int32Array;
  /** Walking ticks of each waypoint pair W_j -> W_j+1 (MAX_WAYPOINTS - 1 per slot). */
  legTicks: Int32Array;
  routineSeed: Int32Array;
  waypointCount: Uint8Array;
  /**
   * Presentation only (never saved or simulated): how far the animal was bedded when its region
   * slept, so the drawing rises it during the first dwell instead of walking the routine lying.
   */
  restAtAnchor: Float32Array;
  /** (x, z) pairs, MAX_WAYPOINTS per slot. */
  waypoints: Float32Array;
}

export const createDormantPool = (capacity: number): DormantPool => ({
  ageAtAnchor: new Float32Array(capacity),
  anchorHeading: new Float32Array(capacity),
  anchorTick: new Int32Array(capacity),
  appearAtAnchor: new Float32Array(capacity),
  cycleTicks: new Int32Array(capacity),
  dwellTicks: new Int32Array(capacity * MAX_VISITS),
  legTicks: new Int32Array(capacity * (MAX_WAYPOINTS - 1)),
  restAtAnchor: new Float32Array(capacity),
  routineSeed: new Int32Array(capacity),
  waypointCount: new Uint8Array(capacity),
  waypoints: new Float32Array(capacity * MAX_WAYPOINTS * 2)
});

/** The closed-form pose of a dormant animal at a tick (scratch, no allocation). */
export interface DormantPose {
  heading: number;
  /** Ticks left of the current dwell or leg. */
  remainingTicks: number;
  speed: number;
  state: number;
  targetX: number;
  targetZ: number;
  walking: boolean;
  x: number;
  z: number;
}

export const dormantPose: DormantPose = {
  heading: 0, remainingTicks: 0, speed: 0, state: ANIMAL_STATE.graze, targetX: 0, targetZ: 0,
  walking: false, x: 0, z: 0
};

const visitCount = (waypoints: number) => (waypoints < 2 ? 1 : 2 * waypoints - 2);
const waypointOfVisit = (waypoints: number, visit: number) =>
  visit < waypoints ? visit : 2 * waypoints - 2 - visit;
const legOfVisit = (waypoints: number, visit: number) =>
  Math.min(waypointOfVisit(waypoints, visit), waypointOfVisit(waypoints, (visit + 1) % visitCount(waypoints)));

const waypointX = (dormant: DormantPool, slot: number, index: number) =>
  dormant.waypoints[(slot * MAX_WAYPOINTS + index) * 2]!;
const waypointZ = (dormant: DormantPool, slot: number, index: number) =>
  dormant.waypoints[(slot * MAX_WAYPOINTS + index) * 2 + 1]!;

const setWaypoint = (dormant: DormantPool, slot: number, index: number, x: number, z: number) => {
  dormant.waypoints[(slot * MAX_WAYPOINTS + index) * 2] = x;
  dormant.waypoints[(slot * MAX_WAYPOINTS + index) * 2 + 1] = z;
};

/** The animal the routine belongs to and where it stands when it goes dormant. */
export interface RoutineInput {
  age: number;
  anchorTick: number;
  appear: number;
  heading: number;
  homeX: number;
  homeZ: number;
  nav: NavWorld;
  routineSeed: number;
  species: number;
  speedFactor: number;
  x: number;
  z: number;
}

const walkSpeed = (species: number, speedFactor: number, age: number) =>
  getSpecies(species).walk.speed * speedFactor * getAgeSpeed(age);

/**
 * The whole-tick schedule of a slot's routine from its waypoints and seed: dwell lengths from the
 * species' grazing range (one seeded draw per visit), leg lengths from the walking speed at the
 * anchor age. Deterministic on every host (integer ticks, DMath distances).
 */
export const buildSchedule = (dormant: DormantPool, slot: number, species: number, speedFactor: number) => {
  const waypoints = dormant.waypointCount[slot]!;
  const speed = walkSpeed(species, speedFactor, dormant.ageAtAnchor[slot]!);
  const legBase = slot * (MAX_WAYPOINTS - 1);
  for (let leg = 0; leg < waypoints - 1; leg += 1) {
    const length = DMath.hypot(
      waypointX(dormant, slot, leg + 1) - waypointX(dormant, slot, leg),
      waypointZ(dormant, slot, leg + 1) - waypointZ(dormant, slot, leg)
    );
    dormant.legTicks[legBase + leg] = Math.max(1, Math.ceil(length / speed / TICK_SECONDS));
  }
  const [shortest, longest] = getSpecies(species).durations.graze;
  const visits = visitCount(waypoints);
  const dwellBase = slot * MAX_VISITS;
  let total = 0;
  for (let visit = 0; visit < visits; visit += 1) {
    const draw = createCellRandom(dormant.routineSeed[slot]!, visit)();
    const dwell = Math.round((shortest + (longest - shortest) * draw) * TICKS_PER_SECOND);
    dormant.dwellTicks[dwellBase + visit] = dwell;
    total += dwell;
    if (waypoints > 1) total += dormant.legTicks[legBase + legOfVisit(waypoints, visit)]!;
  }
  dormant.cycleTicks[slot] = total;
};

const isLegValid = (
  nav: NavWorld, species: number, fromX: number, fromZ: number, toX: number, toZ: number
) =>
  DMath.hypot(toX - fromX, toZ - fromZ) >= MIN_LEG &&
  isStandFree(nav, species, toX, toZ) &&
  isSegmentWalkable(nav, species, fromX, fromZ, toX, toZ) &&
  isSegmentWalkable(nav, species, toX, toZ, fromX, fromZ);

/**
 * Anchors a slot's routine at the animal's current spot: up to four more stops drawn in its
 * home disc, each a validated leg (walkable both ways, free to stand) from the previous one.
 */
export const anchorRoutine = (dormant: DormantPool, slot: number, input: RoutineInput) => {
  dormant.anchorTick[slot] = input.anchorTick;
  dormant.ageAtAnchor[slot] = input.age;
  dormant.anchorHeading[slot] = input.heading;
  dormant.appearAtAnchor[slot] = input.appear;
  dormant.routineSeed[slot] = input.routineSeed;
  setWaypoint(dormant, slot, 0, input.x, input.z);
  const random = createRandom(input.routineSeed);
  let count = 1;
  while (count < MAX_WAYPOINTS) {
    let accepted = false;
    for (let attempt = 0; attempt < WAYPOINT_TRIES && !accepted; attempt += 1) {
      const angle = random() * Math.PI * 2;
      const reach = HOME_RANGE * Math.sqrt(random());
      const x = Math.fround(input.homeX + DMath.cos(angle) * reach);
      const z = Math.fround(input.homeZ + DMath.sin(angle) * reach);
      const previousX = waypointX(dormant, slot, count - 1);
      const previousZ = waypointZ(dormant, slot, count - 1);
      if (!isLegValid(input.nav, input.species, previousX, previousZ, x, z)) continue;
      setWaypoint(dormant, slot, count, x, z);
      count += 1;
      accepted = true;
    }
    if (!accepted) break;
  }
  dormant.waypointCount[slot] = count;
  buildSchedule(dormant, slot, input.species, input.speedFactor);
};

/** Direction of the leg from waypoint `from` to waypoint `to`. */
const legHeading = (dormant: DormantPool, slot: number, from: number, to: number) => DMath.atan2(
  waypointZ(dormant, slot, to) - waypointZ(dormant, slot, from),
  waypointX(dormant, slot, to) - waypointX(dormant, slot, from)
);

/** Eased 0 .. 1 share of the turn after `phase` ticks of a dwell. */
const turnShare = (phase: number) => {
  const linear = Math.min(1, phase / TURN_TICKS);
  return linear * linear * (3 - 2 * linear);
};

/** Where a dwelling animal faced when it arrived: the anchor heading or the leg it came along. */
const arrivalHeading = (dormant: DormantPool, slot: number, visit: number, cycle: number) => {
  const waypoints = dormant.waypointCount[slot]!;
  if (waypoints < 2 || (visit === 0 && cycle === 0)) return dormant.anchorHeading[slot]!;
  const visits = visitCount(waypoints);
  const from = waypointOfVisit(waypoints, (visit + visits - 1) % visits);
  return legHeading(dormant, slot, from, waypointOfVisit(waypoints, visit));
};

const poseAtWaypoint = (
  dormant: DormantPool, slot: number, visit: number, cycle: number, phase: number, dwell: number
) => {
  const waypoints = dormant.waypointCount[slot]!;
  const index = waypointOfVisit(waypoints, visit);
  const next = waypointOfVisit(waypoints, (visit + 1) % visitCount(waypoints));
  dormantPose.x = waypointX(dormant, slot, index);
  dormantPose.z = waypointZ(dormant, slot, index);
  dormantPose.speed = 0;
  dormantPose.walking = false;
  dormantPose.state = visit % 2 === 0 ? ANIMAL_STATE.graze : ANIMAL_STATE.idle;
  dormantPose.remainingTicks = dwell - phase;
  dormantPose.targetX = dormantPose.x;
  dormantPose.targetZ = dormantPose.z;
  const arrived = arrivalHeading(dormant, slot, visit, cycle);
  if (next === index) {
    dormantPose.heading = arrived;
    return dormantPose;
  }
  const leaving = legHeading(dormant, slot, index, next);
  dormantPose.heading = lerpAngle(arrived, leaving, turnShare(phase));
  return dormantPose;
};

const poseOnLeg = (
  dormant: DormantPool, slot: number, from: number, to: number, legTicks: number, elapsed: number
) => {
  const fromX = waypointX(dormant, slot, from);
  const fromZ = waypointZ(dormant, slot, from);
  const toX = waypointX(dormant, slot, to);
  const toZ = waypointZ(dormant, slot, to);
  const fraction = elapsed / legTicks;
  dormantPose.x = Math.fround(lerp(fromX, toX, fraction));
  dormantPose.z = Math.fround(lerp(fromZ, toZ, fraction));
  dormantPose.heading = DMath.atan2(toZ - fromZ, toX - fromX);
  dormantPose.speed = DMath.hypot(toX - fromX, toZ - fromZ) / (legTicks * TICK_SECONDS);
  dormantPose.state = ANIMAL_STATE.walk;
  dormantPose.walking = true;
  dormantPose.targetX = toX;
  dormantPose.targetZ = toZ;
  dormantPose.remainingTicks = legTicks - elapsed;
  return dormantPose;
};

/**
 * The pose of a dormant slot at `tick` (fractional ticks interpolate along a leg for rendering):
 * a pure function of the anchored routine, no stepping and no hidden state.
 */
export const evaluateDormantPose = (dormant: DormantPool, slot: number, tick: number): DormantPose => {
  const waypoints = dormant.waypointCount[slot]!;
  const visits = visitCount(waypoints);
  const cycleTicks = dormant.cycleTicks[slot]!;
  const elapsed = tick - dormant.anchorTick[slot]!;
  const cycle = Math.floor(elapsed / cycleTicks);
  let phase = elapsed - cycle * cycleTicks;
  const dwellBase = slot * MAX_VISITS;
  const legBase = slot * (MAX_WAYPOINTS - 1);
  for (let visit = 0; visit < visits; visit += 1) {
    const dwell = dormant.dwellTicks[dwellBase + visit]!;
    if (phase < dwell) return poseAtWaypoint(dormant, slot, visit, cycle, phase, dwell);
    phase -= dwell;
    if (waypoints < 2) continue;
    const legTicks = dormant.legTicks[legBase + legOfVisit(waypoints, visit)]!;
    const index = waypointOfVisit(waypoints, visit);
    const next = waypointOfVisit(waypoints, (visit + 1) % visits);
    if (phase < legTicks) return poseOnLeg(dormant, slot, index, next, legTicks, phase);
    phase -= legTicks;
  }
  return poseAtWaypoint(dormant, slot, 0, cycle + 1, 0, 1);
};

/** Age of a dormant animal at `tick`: it keeps growing at the species' pace. */
export const dormantAge = (dormant: DormantPool, slot: number, species: number, tick: number) =>
  Math.min(1, dormant.ageAtAnchor[slot]! +
    (tick - dormant.anchorTick[slot]!) * TICK_SECONDS * ageGrowthPerSecond(species));

/** Visual opacity of a dormant animal at `tick` (a newborn one fades in). */
export const dormantAppear = (dormant: DormantPool, slot: number, tick: number) =>
  Math.min(1, dormant.appearAtAnchor[slot]! + (tick - dormant.anchorTick[slot]!) / DORMANT_FADE_TICKS);

/**
 * Drawn rest fold of a dormant animal at `tick`: one bedded when its region slept rises at the
 * species' calm pace. The first dwell (a graze, never shorter than the rise) covers it, so the
 * routine never walks a lying animal.
 */
export const dormantRest = (dormant: DormantPool, slot: number, species: number, tick: number) => {
  const bedded = dormant.restAtAnchor[slot]!;
  if (bedded <= 0) return 0;
  const seconds = (tick - dormant.anchorTick[slot]!) * TICK_SECONDS;
  return Math.max(0, bedded - seconds * getRiseRate(species, false));
};

/** The slot's routine waypoints as a flat (x, z) list (saving). */
export const routineWaypoints = (dormant: DormantPool, slot: number) =>
  dormant.waypoints.subarray(slot * MAX_WAYPOINTS * 2, (slot * MAX_WAYPOINTS + dormant.waypointCount[slot]!) * 2);

/** What a save keeps of a routine; the schedule is derived again. */
export interface SavedRoutine {
  age: number;
  anchorTick: number;
  appear: number;
  heading: number;
  routineSeed: number;
  waypoints: ArrayLike<number>;
}

/** Restores a slot's saved anchor and waypoints, then derives its schedule. */
export const restoreRoutine = (
  dormant: DormantPool,
  slot: number,
  saved: SavedRoutine,
  species: number,
  speedFactor: number
) => {
  dormant.anchorTick[slot] = saved.anchorTick;
  dormant.ageAtAnchor[slot] = saved.age;
  dormant.restAtAnchor[slot] = 0;
  dormant.anchorHeading[slot] = saved.heading;
  dormant.appearAtAnchor[slot] = saved.appear;
  dormant.routineSeed[slot] = saved.routineSeed;
  dormant.waypointCount[slot] = saved.waypoints.length / 2;
  dormant.waypoints.set(saved.waypoints, slot * MAX_WAYPOINTS * 2);
  buildSchedule(dormant, slot, species, speedFactor);
};
