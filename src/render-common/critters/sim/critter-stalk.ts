import { approach } from "../../birds/bird-flight";
import { CRITTER } from "../critter-species";
import { CLIP } from "../model/critter-model";
import { steerCritterBirdFlight } from "./critter-building-flight";
import { type CritterContext, distanceTo, getAwayHeading, moveForward, pickDuration, pickTargetNear, setTimedMode, steerTowards } from "./critter-context";
import type { CritterPool } from "./critter-pool";

/**
 * Long legged birds on foot: the heron stands still for long stretches in the shallows, stalks
 * a few slow steps, aims and strikes into the water; gulls stroll the beach, peck and look
 * around. A worker coming close makes them take off: a few wing beats, climbing away, then
 * gone (their site stays empty for a while).
 */
export const STALK_MODE = { stand: 0, walk: 1, feed: 2, look: 3, fly: 4 } as const;

interface StalkStyle {
  /** World units per walk cycle (two steps). */
  cycleLength: number;
  /** Seconds of one feeding action. */
  feed: readonly [number, number];
  /** Share of calm choices: walk, feed, look (the rest: stand). */
  odds: readonly [number, number, number];
  fleeRadius: number;
  range: number;
  /** Strike ripples (wading). */
  splash: boolean;
  stand: readonly [number, number];
  walkSpeed: number;
  /** Where its feet may go. */
  canWalk: (context: CritterContext) => (x: number, z: number) => boolean;
}

const HERON: StalkStyle = {
  canWalk: (context) => (x, z) => {
    const depth = context.terrain.depth(x, z);
    return depth > 0.015 && depth < 0.24;
  },
  cycleLength: 0.34,
  feed: [1.4, 2.4],
  fleeRadius: 4,
  odds: [0.35, 0.3, 0.15],
  range: 2.6,
  splash: true,
  stand: [4, 16],
  walkSpeed: 0.1
};

const GULL: StalkStyle = {
  canWalk: (context) => (x, z) =>
    context.terrain.depth(x, z) < 0.03 && context.terrain.sand(x, z) > 0.3,
  cycleLength: 0.16,
  feed: [0.5, 0.9],
  fleeRadius: 3,
  odds: [0.4, 0.3, 0.15],
  range: 2.4,
  splash: false,
  stand: [1.5, 6],
  walkSpeed: 0.28
};

const FLY_SPEED = 1.6;
const CLIMB_RATE = 1.3;
const FLAPS_PER_SECOND = 2.6;
const FLY_SECONDS = 2.4;
const TURN_RATE = 2.2;

const getSpeciesStyle = (species: number) => (species === CRITTER.heron ? HERON : GULL);

const getStyle = (pool: CritterPool, index: number) => getSpeciesStyle(pool.species[index]!);

/** Where a heron (in the shallows) or a gull (on dry ground) may walk. */
export const canStalk = (context: CritterContext, species: number) =>
  getSpeciesStyle(species).canWalk(context);

const startWalk = (
  pool: CritterPool,
  index: number,
  context: CritterContext,
  style: StalkStyle
) => {
  const site = context.sites[pool.site[index]!]!;
  const target = pickTargetNear(context, site, style.range, style.canWalk(context));
  if (!target) return setTimedMode(pool, index, STALK_MODE.stand, 2);
  pool.targetX[index] = target.x;
  pool.targetZ[index] = target.z;
  setTimedMode(pool, index, STALK_MODE.walk, 25);
};

const chooseActivity = (pool: CritterPool, index: number, context: CritterContext) => {
  const style = getStyle(pool, index);
  const { random } = context;
  const resting = context.daylight < 0.25;
  const roll = random();
  const [walk, feed, look] = style.odds;
  if (resting || roll >= walk + feed + look) {
    return setTimedMode(pool, index, STALK_MODE.stand, pickDuration(random, ...style.stand));
  }
  if (roll < walk) return startWalk(pool, index, context, style);
  if (roll < walk + feed)
    return setTimedMode(pool, index, STALK_MODE.feed, pickDuration(random, ...style.feed));
  setTimedMode(pool, index, STALK_MODE.look, pickDuration(random, 1.2, 3));
};

/** Heron: aim (neck drawn back over the water), hold, strike fast, recover; gull: one peck. */
const getFeedAmount = (progress: number, splash: boolean) => {
  if (!splash) return Math.sin(Math.min(1, progress) * Math.PI);
  if (progress < 0.35) return (progress / 0.35) * 0.5;
  if (progress < 0.7) return 0.5;
  if (progress < 0.8) return 0.5 + ((progress - 0.7) / 0.1) * 0.5;
  return Math.max(0, 1 - (progress - 0.8) / 0.2);
};

const updateFeed = (
  pool: CritterPool,
  index: number,
  context: CritterContext,
  style: StalkStyle
) => {
  const progress = 1 - pool.timer[index]! / Math.max(0.01, pool.originZ[index]!);
  const before = pool.pose[index]!;
  pool.pose[index] = getFeedAmount(progress, style.splash);
  const struck = style.splash && before < 0.98 && pool.pose[index]! >= 0.98;
  if (!struck) return;
  const reach = 0.3;
  const x = pool.x[index]! + Math.cos(pool.heading[index]!) * reach;
  const z = pool.z[index]! + Math.sin(pool.heading[index]!) * reach;
  context.emitRipple(x, z, 0.3);
};

const updateWalk = (
  pool: CritterPool,
  index: number,
  context: CritterContext,
  style: StalkStyle
) => {
  steerTowards(pool, index, pool.targetX[index]!, pool.targetZ[index]!, TURN_RATE, context.step);
  pool.speed[index] = style.walkSpeed;
  const moved = moveForward(pool, index, context.step, style.canWalk(context));
  const arrived = distanceTo(pool, index, pool.targetX[index]!, pool.targetZ[index]!) < 0.1;
  if (!moved || arrived) pool.timer[index] = 0;
  if (moved)
    pool.pose[index] = pool.pose[index]! + (style.walkSpeed * context.step) / style.cycleLength;
};

/** Flying off: beats, climbs and heads away from the threat; then the slot fades out. */
const updateFlight = (pool: CritterPool, index: number, context: CritterContext) => {
  pool.speed[index] = approach(pool.speed[index]!, FLY_SPEED, context.step * 2.5);
  steerCritterBirdFlight(pool, index, context);
  pool.lift[index] = pool.lift[index]! + CLIMB_RATE * context.step;
  pool.x[index] =
    pool.x[index]! + Math.cos(pool.heading[index]!) * pool.speed[index]! * context.step;
  pool.z[index] =
    pool.z[index]! + Math.sin(pool.heading[index]!) * pool.speed[index]! * context.step;
  pool.pose[index] = pool.pose[index]! + FLAPS_PER_SECOND * context.step;
  if (pool.timer[index]! <= 0) pool.leaving[index] = 1;
};

const checkThreat = (
  pool: CritterPool,
  index: number,
  context: CritterContext,
  style: StalkStyle
) => {
  if (pool.mode[index] === STALK_MODE.fly) return;
  const threat = context.findThreat(pool.x[index]!, pool.z[index]!, style.fleeRadius);
  if (!threat) return;
  pool.heading[index] =
    getAwayHeading(pool, index, threat.x, threat.z) + (context.random() - 0.5) * 0.6;
  pool.speed[index] = 0.3;
  setTimedMode(pool, index, STALK_MODE.fly, FLY_SECONDS);
  context.leaveSite(pool.site[index]!);
  if (style.splash) context.emitRipple(pool.x[index]!, pool.z[index]!, 0.35);
};

const CLIPS = [CLIP.idle, CLIP.move, CLIP.feed, CLIP.look, CLIP.fly];

const updateLook = (pool: CritterPool, index: number, context: CritterContext) => {
  const target = pool.timer[index]! < 0.5 ? 0 : 1;
  pool.pose[index] = approach(pool.pose[index]!, target, context.step * 2.5);
};

const updateMode = (
  pool: CritterPool,
  index: number,
  context: CritterContext,
  style: StalkStyle
) => {
  const mode = pool.mode[index]!;
  if (mode === STALK_MODE.fly) return updateFlight(pool, index, context);
  if (mode === STALK_MODE.walk) return updateWalk(pool, index, context, style);
  if (mode === STALK_MODE.feed) return updateFeed(pool, index, context, style);
  if (mode === STALK_MODE.look) return updateLook(pool, index, context);
  pool.speed[index] = 0;
};

/** The bed under shallow water (the same depth the walking rule reads), else the ground. */
const getFootHeight = (context: CritterContext, x: number, z: number) => {
  const depth = context.terrain.depth(x, z);
  if (depth <= 0.02) return context.terrain.ground(x, z);
  return context.terrain.water(x, z) - depth;
};

/** One step of a heron or gull on foot (or flying off). */
export const updateStalker = (pool: CritterPool, index: number, context: CritterContext) => {
  const style = getStyle(pool, index);
  checkThreat(pool, index, context, style);
  pool.timer[index] = pool.timer[index]! - context.step;
  if (pool.timer[index]! <= 0 && pool.mode[index] !== STALK_MODE.fly)
    chooseActivity(pool, index, context);
  const clip = CLIPS[pool.mode[index]!]!;
  if (clip !== pool.clip[index]) pool.pose[index] = 0;
  pool.clip[index] = clip;
  updateMode(pool, index, context, style);
  pool.y[index] = getFootHeight(context, pool.x[index]!, pool.z[index]!) + pool.lift[index]!;
};

export const spawnStalker = (pool: CritterPool, index: number, context: CritterContext) => {
  setTimedMode(pool, index, STALK_MODE.stand, pickDuration(context.random, 0.5, 6));
  pool.clip[index] = CLIP.idle;
  pool.lift[index] = 0;
};
