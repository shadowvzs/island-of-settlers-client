import { randomBetween } from "../../../shared/world/rng";
import { wrapAngle } from "../../birds/bird-flight";
import { CLIP } from "../model/critter-model";
import { type CritterContext, getAwayHeading, moveForward, pickDuration, pickTargetNear, setMode } from "./critter-context";
import type { CritterPool } from "./critter-pool";

/**
 * Crabs on the beach at the water line: short sideways scuttles (the body faces across the way
 * it runs), pauses, now and then claws raised; a worker close by sends them racing sideways
 * away and digging into the wet sand (out of sight) until it is quiet again.
 * Pool use: target = where it scuttles to, originX = side it runs (+1 left, -1 right).
 */
const SCUTTLE_MODE = { still: 0, walk: 1, claws: 2, flee: 3, buried: 4 } as const;

const STILL_SECONDS = [1, 6] as const;
const BURIED_SECONDS = [6, 15] as const;
const WALK_SPEED = 0.16;
const FLEE_SPEED = 0.55;
const WALK_REACH = 0.9;
const SITE_RANGE = 1.8;
const THREAT_RADIUS = 2.4;
const FLEE_SECONDS = 1.2;
const CYCLE = 0.05;
const ARRIVED = 0.04;

/** Sand or the wet edge of the sea where a crab walks. */
export const canScuttle = (context: CritterContext) => (x: number, z: number) =>
  context.terrain.depth(x, z) < 0.04 && context.terrain.sand(x, z) > 0.3;

/** Faces across the way to the target and remembers which side it runs. */
const faceAcross = (pool: CritterPool, index: number, x: number, z: number) => {
  const way = Math.atan2(z - pool.z[index]!, x - pool.x[index]!);
  const side = wrapAngle(way - pool.heading[index]!) > 0 ? 1 : -1;
  pool.originX[index] = side;
  pool.heading[index] = wrapAngle(way - (side * Math.PI) / 2);
};

const startWalk = (pool: CritterPool, index: number, context: CritterContext) => {
  const site = context.sites[pool.site[index]!]!;
  const from = { x: pool.x[index]!, z: pool.z[index]! };
  const accept = (x: number, z: number) =>
    Math.hypot(x - site.x, z - site.z) <= SITE_RANGE && canScuttle(context)(x, z);
  const target = pickTargetNear(context, from, WALK_REACH, accept);
  if (!target) return setMode(pool, index, SCUTTLE_MODE.still, 1);
  pool.targetX[index] = target.x;
  pool.targetZ[index] = target.z;
  faceAcross(pool, index, target.x, target.z);
  setMode(pool, index, SCUTTLE_MODE.walk, 8);
};

/** Moves sideways (the heading turned a quarter to its running side). */
const scuttle = (pool: CritterPool, index: number, context: CritterContext, speed: number) => {
  const heading = pool.heading[index]!;
  pool.heading[index] = heading + (pool.originX[index]! * Math.PI) / 2;
  pool.speed[index] = speed;
  const moved = moveForward(pool, index, context.step, canScuttle(context));
  pool.heading[index] = heading;
  pool.pose[index] = pool.pose[index]! + (speed * context.step) / CYCLE;
  return moved;
};

const chooseActivity = (pool: CritterPool, index: number, context: CritterContext) => {
  const { random } = context;
  const roll = random();
  if (roll < 0.5) return startWalk(pool, index, context);
  if (roll < 0.65) return setMode(pool, index, SCUTTLE_MODE.claws, randomBetween(random, 1, 2.5));
  setMode(pool, index, SCUTTLE_MODE.still, pickDuration(random, ...STILL_SECONDS));
};

const checkThreat = (pool: CritterPool, index: number, context: CritterContext) => {
  const mode = pool.mode[index]!;
  if (mode === SCUTTLE_MODE.flee || mode === SCUTTLE_MODE.buried) return;
  const threat = context.findThreat(pool.x[index]!, pool.z[index]!, THREAT_RADIUS);
  if (!threat) return;
  const away = getAwayHeading(pool, index, threat.x, threat.z);
  faceAcross(pool, index, pool.x[index]! + Math.cos(away), pool.z[index]! + Math.sin(away));
  setMode(pool, index, SCUTTLE_MODE.flee, FLEE_SECONDS);
};

const CLIP_OF: Record<number, number> = {
  [SCUTTLE_MODE.still]: CLIP.idle,
  [SCUTTLE_MODE.walk]: CLIP.move,
  [SCUTTLE_MODE.claws]: CLIP.look,
  [SCUTTLE_MODE.flee]: CLIP.fast,
  [SCUTTLE_MODE.buried]: CLIP.idle
};

const updateMode = (pool: CritterPool, index: number, context: CritterContext) => {
  const mode = pool.mode[index]!;
  if (mode === SCUTTLE_MODE.walk) {
    const moved = scuttle(pool, index, context, WALK_SPEED);
    const left = Math.hypot(
      pool.targetX[index]! - pool.x[index]!,
      pool.targetZ[index]! - pool.z[index]!
    );
    if (!moved || left < ARRIVED) pool.timer[index] = 0;
  }
  if (mode === SCUTTLE_MODE.flee) scuttle(pool, index, context, FLEE_SPEED);
  if (mode === SCUTTLE_MODE.claws)
    pool.pose[index] = Math.min(1, pool.pose[index]! + context.step * 4);
  if (pool.timer[index]! > 0) return;
  if (mode === SCUTTLE_MODE.flee) {
    pool.hidden[index] = 1;
    return setMode(
      pool,
      index,
      SCUTTLE_MODE.buried,
      randomBetween(context.random, ...BURIED_SECONDS)
    );
  }
  pool.hidden[index] = 0;
  chooseActivity(pool, index, context);
};

/** One step of a crab. */
export const updateScuttler = (pool: CritterPool, index: number, context: CritterContext) => {
  checkThreat(pool, index, context);
  pool.timer[index] = pool.timer[index]! - context.step;
  const clip = CLIP_OF[pool.mode[index]!]!;
  if (clip !== pool.clip[index]) pool.pose[index] = 0;
  pool.clip[index] = clip;
  updateMode(pool, index, context);
  pool.y[index] = context.terrain.water(pool.x[index]!, pool.z[index]!);
};

export const spawnScuttler = (pool: CritterPool, index: number, context: CritterContext) => {
  pool.lift[index] = 0;
  pool.originX[index] = 1;
  setMode(pool, index, SCUTTLE_MODE.still, pickDuration(context.random, ...STILL_SECONDS));
};
