import { approach } from "../../birds/bird-flight";
import { CRITTER } from "../critter-species";
import { CLIP } from "../model/critter-model";
import { type CritterContext, distanceTo, getAwayHeading, moveForward, pickDuration, pickTargetNear, setMode, steerTowards } from "./critter-context";
import type { CritterPool } from "./critter-pool";

/**
 * Swimming waterfowl (mallards) on calm water: the leader drifts, paddles to a new spot, dabbles
 * (bill dips or tips up), looks around and sleeps at night; ducklings line up behind their hen,
 * other adults keep near. A worker coming close sends them paddling away fast. Every moving
 * duck leaves a small wake.
 */
const SWIM_MODE = { drift: 0, paddle: 1, feed: 2, look: 3, rest: 4, flee: 5 } as const;

const PADDLE_SPEED = 0.11;
const FLEE_SPEED = 0.42;
const FLEE_RADIUS = 2.8;
const SAFE_RADIUS = 5.5;
const TURN_RATE = 1.6;
const FOLLOW_GAP = 0.2;
const WAKE_SECONDS = [0.55, 0.9] as const;
const WAKE_SIZE = 0.24;
/** Ring of a duck tipping up to dabble (a splash). */
const TIP_SPLASH = 0.3;
/** The phase of the paddling cycle per world unit swum. */
const STROKES_PER_UNIT = 4;
const BOB_HEIGHT = 0.006;

const isDuckling = (pool: CritterPool, index: number) => pool.species[index] === CRITTER.duckling;

export const canSwim = (context: CritterContext) => (x: number, z: number) =>
  context.terrain.depth(x, z) > 0.1 && context.terrain.stillness(x, z) > 0.12;

/** Leader's next calm activity (asleep through most of the night). */
const chooseActivity = (pool: CritterPool, index: number, context: CritterContext) => {
  const { random } = context;
  if (context.daylight < 0.3 && random() < 0.75) {
    setMode(pool, index, SWIM_MODE.rest, pickDuration(random, 12, 40));
    return;
  }
  const roll = random();
  if (roll < 0.4) return startPaddle(pool, index, context);
  if (roll < 0.62) return setMode(pool, index, SWIM_MODE.drift, pickDuration(random, 2, 8));
  if (roll < 0.86) {
    pool.originX[index] = random() < 0.5 ? 0.5 : 1;
    if (pool.originX[index] === 1) context.emitRipple(pool.x[index]!, pool.z[index]!, TIP_SPLASH);
    return setMode(pool, index, SWIM_MODE.feed, pickDuration(random, 2.5, 6));
  }
  pool.originX[index] = random() < 0.5 ? 0 : 1;
  setMode(pool, index, SWIM_MODE.look, pickDuration(random, 1.5, 3.5));
};

const startPaddle = (pool: CritterPool, index: number, context: CritterContext) => {
  const site = context.sites[pool.site[index]!]!;
  const target = pickTargetNear(context, site, 3.2, canSwim(context));
  if (!target) return setMode(pool, index, SWIM_MODE.drift, 3);
  pool.targetX[index] = target.x;
  pool.targetZ[index] = target.z;
  setMode(pool, index, SWIM_MODE.paddle, 30);
};

/** Pose amount easing in and out over the mode (dabbling, looking, falling asleep). */
const easePose = (pool: CritterPool, index: number, goal: number, step: number) => {
  const closing = pool.timer[index]! < 0.8;
  const target = closing ? 0 : goal;
  const rate = target > pool.pose[index]! ? 1.6 : 2.2;
  pool.pose[index] = approach(pool.pose[index]!, target, rate * step);
};

const updateLeader = (pool: CritterPool, index: number, context: CritterContext) => {
  const mode = pool.mode[index]!;
  if (mode === SWIM_MODE.paddle) {
    steerTowards(pool, index, pool.targetX[index]!, pool.targetZ[index]!, TURN_RATE, context.step);
    pool.speed[index] = PADDLE_SPEED;
    const arrived = distanceTo(pool, index, pool.targetX[index]!, pool.targetZ[index]!) < 0.15;
    if (arrived) pool.timer[index] = 0;
    return;
  }
  pool.speed[index] = Math.max(0, pool.speed[index]! - 0.08 * context.step);
};

/** Followers sleep and flee with their leader, otherwise they just swim along. */
const isShared = (mode: number) => mode === SWIM_MODE.rest || mode === SWIM_MODE.flee;

/** Followers: ducklings in a line behind the hen, adults loosely beside the leader. */
const updateFollower = (
  pool: CritterPool,
  index: number,
  leader: number,
  context: CritterContext
) => {
  const duckling = isDuckling(pool, index);
  const gap = duckling ? FOLLOW_GAP * pool.member[index]! : 0.45;
  const sideSign = pool.member[index]! % 2 === 0 ? 1 : -1;
  const wiggle = Math.sin(context.time * 0.7 + pool.seed[index]! * 9) * 0.05;
  const side = duckling ? wiggle : 0.3 * sideSign;
  const heading = pool.heading[leader]!;
  const x = pool.x[leader]! - Math.cos(heading) * gap - Math.sin(heading) * side;
  const z = pool.z[leader]! - Math.sin(heading) * gap + Math.cos(heading) * side;
  const distance = distanceTo(pool, index, x, z);
  if (distance > 0.06) steerTowards(pool, index, x, z, TURN_RATE * 1.5, context.step);
  else pool.heading[index] = pool.heading[index]! + (heading - pool.heading[index]!) * 0.05;
  pool.speed[index] = Math.min(FLEE_SPEED * 1.1, distance * 0.9);
  const leaderMode = pool.mode[leader]!;
  pool.mode[index] = isShared(leaderMode) ? leaderMode : SWIM_MODE.drift;
};

const updateFlee = (pool: CritterPool, index: number, context: CritterContext) => {
  const threat = context.findThreat(pool.x[index]!, pool.z[index]!, SAFE_RADIUS);
  if (!threat && pool.timer[index]! <= 0) return setMode(pool, index, SWIM_MODE.drift, 2);
  if (threat) {
    const away = getAwayHeading(pool, index, threat.x, threat.z);
    pool.targetX[index] = pool.x[index]! + Math.cos(away) * 2;
    pool.targetZ[index] = pool.z[index]! + Math.sin(away) * 2;
  }
  steerTowards(
    pool,
    index,
    pool.targetX[index]!,
    pool.targetZ[index]!,
    TURN_RATE * 2,
    context.step
  );
  pool.speed[index] = FLEE_SPEED;
};

const checkThreat = (pool: CritterPool, index: number, context: CritterContext) => {
  if (pool.leader[index]! >= 0 || pool.mode[index] === SWIM_MODE.flee) return;
  if (!context.findThreat(pool.x[index]!, pool.z[index]!, FLEE_RADIUS)) return;
  setMode(pool, index, SWIM_MODE.flee, 3);
};

const getClip = (mode: number) => {
  if (mode === SWIM_MODE.paddle) return CLIP.move;
  if (mode === SWIM_MODE.flee) return CLIP.fast;
  if (mode === SWIM_MODE.feed) return CLIP.feed;
  if (mode === SWIM_MODE.look) return CLIP.look;
  if (mode === SWIM_MODE.rest) return CLIP.rest;
  return CLIP.idle;
};

/** Clip and pose: strokes follow the distance swum, held poses ease in and out. */
const animate = (pool: CritterPool, index: number, context: CritterContext, swum: number) => {
  const clip = getClip(pool.mode[index]!);
  if (clip !== pool.clip[index]) pool.pose[index] = clip === CLIP.look ? 0.5 : 0;
  pool.clip[index] = clip;
  if (clip === CLIP.rest) return easePose(pool, index, 1, context.step);
  if (clip === CLIP.feed || clip === CLIP.look) {
    return easePose(pool, index, pool.originX[index]!, context.step);
  }
  pool.pose[index] = pool.pose[index]! + swum * STROKES_PER_UNIT + context.step * 0.25;
};

const emitWake = (pool: CritterPool, index: number, context: CritterContext) => {
  pool.clock[index] = pool.clock[index]! - context.step;
  if (pool.speed[index]! < 0.08 || pool.clock[index]! > 0) return;
  pool.clock[index] = WAKE_SECONDS[0] + context.random() * (WAKE_SECONDS[1] - WAKE_SECONDS[0]);
  const size = WAKE_SIZE * (isDuckling(pool, index) ? 0.5 : 1);
  context.emitRipple(pool.x[index]!, pool.z[index]!, size * (pool.speed[index]! > 0.3 ? 1.4 : 1));
};

/** One step of a swimming critter. */
export const updateSwimmer = (pool: CritterPool, index: number, context: CritterContext) => {
  checkThreat(pool, index, context);
  pool.timer[index] = pool.timer[index]! - context.step;
  const leader = pool.leader[index]!;
  if (leader >= 0 && pool.active[leader] === 1) updateFollower(pool, index, leader, context);
  else if (pool.mode[index] === SWIM_MODE.flee) updateFlee(pool, index, context);
  else {
    if (pool.timer[index]! <= 0) chooseActivity(pool, index, context);
    updateLeader(pool, index, context);
  }
  const before = pool.speed[index]! * context.step;
  const moved = moveForward(pool, index, context.step, canSwim(context));
  if (!moved && leader < 0) pool.timer[index] = Math.min(pool.timer[index]!, 0);
  animate(pool, index, context, moved ? before : 0);
  emitWake(pool, index, context);
  const bob = Math.sin(context.time * 1.7 + pool.seed[index]! * 20) * BOB_HEIGHT;
  pool.y[index] = context.terrain.water(pool.x[index]!, pool.z[index]!) + bob;
};

/** A swimmer placed at its site: a calm start, the followers spread behind the leader. */
export const spawnSwimmer = (pool: CritterPool, index: number, context: CritterContext) => {
  setMode(pool, index, SWIM_MODE.drift, pickDuration(context.random, 0.5, 4));
  pool.clip[index] = CLIP.idle;
  pool.pose[index] = context.random();
  pool.clock[index] = context.random();
};
