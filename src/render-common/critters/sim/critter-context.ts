import type { Random } from "../../../shared/world/rng";
import type { BirdBuildingAvoidance } from "../../birds/bird-building-avoidance";
import { approach, wrapAngle } from "../../birds/bird-flight";
import type { NavWorld } from "../../wildlife/nav/nav-query";
import { turnSmoothly } from "../../wildlife/nav/nav-steering";
import type { CritterSite } from "../habitat/critter-sites";
import type { CritterTerrain } from "../habitat/critter-terrain";
import type { ClimbableTrees } from "../habitat/critter-trees";
import type { CritterPool } from "./critter-pool";

/** Everything the critter behaviours share during a step. */
export interface CritterContext {
  buildings?: BirdBuildingAvoidance;
  /** 0 night .. 1 day. */
  daylight: number;
  /** Expanding water ring at a point (wakes, splashes). */
  emitRipple: (x: number, z: number, size: number) => void;
  /** A member left its site (flew off): the site stays empty for a while. */
  leaveSite: (site: number) => void;
  /** Trees squirrels climb (null: none to climb). */
  trees: ClimbableTrees | null;
  /** The wildlife navigation (trunks, rocks, water, cliffs) when built; terrain checks without. */
  nav: NavWorld | null;
  random: Random;
  sites: readonly CritterSite[];
  step: number;
  terrain: CritterTerrain;
  /** Nearest threat (worker, felling) within `radius` of a point: its position, or null. */
  findThreat: (x: number, z: number, radius: number) => { x: number; z: number } | null;
  time: number;
}

/** Duration skewed to the short end (many short pauses, a few long ones). */
export const pickDuration = (random: Random, min: number, max: number) =>
  min + (max - min) * Math.pow(random(), 1.6);

/** Turns the heading towards a point by at most `rate` radians per second. */
export const steerTowards = (
  pool: CritterPool,
  index: number,
  x: number,
  z: number,
  rate: number,
  step: number
) => {
  const wanted = Math.atan2(z - pool.z[index]!, x - pool.x[index]!);
  const turn = wrapAngle(wanted - pool.heading[index]!);
  pool.heading[index] = turnSmoothly(pool.heading[index]!, wanted, rate, step);
  return Math.abs(turn);
};

/** Heading straight away from a point. */
export const getAwayHeading = (pool: CritterPool, index: number, x: number, z: number) =>
  Math.atan2(pool.z[index]! - z, pool.x[index]! - x);

/**
 * Moves forward at the current speed when the next point is allowed; false (and no move) when
 * it is not (the shore, a cliff): the caller turns or picks a new target.
 */
export const moveForward = (
  pool: CritterPool,
  index: number,
  step: number,
  canEnter: (x: number, z: number) => boolean
) => {
  const distance = pool.speed[index]! * step;
  const x = pool.x[index]! + Math.cos(pool.heading[index]!) * distance;
  const z = pool.z[index]! + Math.sin(pool.heading[index]!) * distance;
  if (!canEnter(x, z)) return false;
  pool.x[index] = x;
  pool.z[index] = z;
  return true;
};

/** Heading offsets tried when the way ahead is blocked (a trunk, a rock): slight, then wider. */
const SIDESTEPS = [0.6, -0.6, 1.3, -1.3];
const always = () => true;

/**
 * Moves forward, or sidesteps around an obstacle (turning to the first free heading of a few):
 * followers keep up with their leader through the trees. False when every way is blocked.
 */
export const moveAround = (
  pool: CritterPool,
  index: number,
  step: number,
  canEnter: (x: number, z: number) => boolean,
  maxTurn = Infinity
) => {
  if (moveForward(pool, index, step, canEnter)) return true;
  const heading = pool.heading[index]!;
  for (const turn of SIDESTEPS) {
    const candidate = wrapAngle(heading + turn);
    const distance = pool.speed[index]! * step;
    if (
      !canEnter(
        pool.x[index]! + Math.cos(candidate) * distance,
        pool.z[index]! + Math.sin(candidate) * distance
      )
    )
      continue;
    pool.heading[index] = wrapAngle(heading + approach(0, wrapAngle(candidate - heading), maxTurn));
    if (moveForward(pool, index, step, canEnter)) return true;
    // The free direction needs several steps of turning. Keep the bounded turn, rather
    // than snapping to that direction or undoing it and choosing a new leg immediately.
    return false;
  }
  pool.heading[index] = heading;
  /** Standing inside an obstacle already (placed there, pushed): walk out straight. */
  if (!canEnter(pool.x[index]!, pool.z[index]!)) return moveForward(pool, index, step, always);
  return false;
};

/** A random allowed point within `range` of a centre (a site; null after a few misses). */
export const pickTargetNear = (
  context: CritterContext,
  site: { x: number; z: number },
  range: number,
  accept: (x: number, z: number) => boolean
) => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const angle = context.random() * Math.PI * 2;
    const distance = Math.sqrt(context.random()) * range;
    const x = site.x + Math.cos(angle) * distance;
    const z = site.z + Math.sin(angle) * distance;
    if (accept(x, z)) return { x, z };
  }
  return null;
};

export const distanceTo = (pool: CritterPool, index: number, x: number, z: number) =>
  Math.hypot(x - pool.x[index]!, z - pool.z[index]!);

/** Starts behaviour `mode` for `seconds`. */
export const setMode = (pool: CritterPool, index: number, mode: number, seconds: number) => {
  pool.mode[index] = mode;
  pool.timer[index] = seconds;
};

/** Starts `mode` and remembers its full duration (in originZ) for progress through the mode. */
export const setTimedMode = (pool: CritterPool, index: number, mode: number, seconds: number) => {
  setMode(pool, index, mode, seconds);
  pool.originZ[index] = seconds;
};
