import { randomBetween } from "../../../shared/world/rng";
import { approach } from "../../birds/bird-flight";
import { CLIP } from "../model/critter-model";
import { type CritterContext, distanceTo, moveAround, pickDuration, pickTargetNear, setMode, steerTowards } from "./critter-context";
import type { CritterPool } from "./critter-pool";

/**
 * Seals hauled out on coastal rocks and quiet beaches: they lie for long stretches, lift the
 * head to look around, bask in the banana pose, shuffle a little, now and then hump down into
 * the sea, swim about with the head and back showing, dive and haul out again. Anyone close
 * sends them humping for the water and under at once. Pool use: target = where it heads,
 * originX = 1 while it flees, originZ = the pose the current action aims at.
 */
const HAUL_MODE = { lie: 0, look: 1, bask: 2, go: 3, swim: 4, under: 5 } as const;

const LIE_SECONDS = [5, 20] as const;
const SWIM_SECONDS = [6, 16] as const;
const UNDER_SECONDS = [4, 10] as const;
const SCARED_SECONDS = [14, 26] as const;
const CRAWL_SPEED = 0.1;
const FLEE_SPEED = 0.3;
const SWIM_SPEED = 0.22;
const CRAWL_CYCLE = 0.12;
const SHUFFLE_REACH = 0.8;
const WATER_REACH = 2.6;
const SWIM_RANGE = 3.5;
const HAUL_RANGE = 1.6;
const THREAT_RADIUS = 5;
const TURN_RATE = 1.4;
const ARRIVED = 0.12;
/** Water this deep is swum, shallower ground crawled. */
const SWIM_DEPTH = 0.12;
const MAX_SLOPE = 0.7;

const inBounds = (context: CritterContext, x: number, z: number) =>
  x >= 0 && z >= 0 && x <= context.terrain.world.cellsX && z <= context.terrain.world.cellsZ;
const isSwimWater = (context: CritterContext, x: number, z: number) =>
  inBounds(context, x, z) && context.terrain.depth(x, z) > SWIM_DEPTH;

/** Shore where a seal lies: sand or stone, dry or barely wet, not steep. */
export const canHaul =
  (context: CritterContext) =>
  (x: number, z: number) => {
    if (!inBounds(context, x, z)) return false;
    const { terrain } = context;
    if (terrain.depth(x, z) > 0.05 || terrain.slope(x, z) > MAX_SLOPE) return false;
    return terrain.sand(x, z) + terrain.stony(x, z) > 0.4;
  };

const canMove = (context: CritterContext) => (x: number, z: number) =>
  inBounds(context, x, z) && (isSwimWater(context, x, z) || context.terrain.slope(x, z) < MAX_SLOPE);

const goTo = (pool: CritterPool, index: number, target: { x: number; z: number }, flee = false) => {
  pool.targetX[index] = target.x;
  pool.targetZ[index] = target.z;
  pool.originX[index] = flee ? 1 : 0;
  setMode(pool, index, HAUL_MODE.go, 40);
};

const pickWater = (context: CritterContext, centre: { x: number; z: number }, reach: number) =>
  pickTargetNear(context, centre, reach, (x, z) => isSwimWater(context, x, z));

const startSwim = (pool: CritterPool, index: number, context: CritterContext) =>
  setMode(pool, index, HAUL_MODE.swim, randomBetween(context.random, ...SWIM_SECONDS));

const chooseOnLand = (pool: CritterPool, index: number, context: CritterContext) => {
  const { random } = context;
  const here = { x: pool.x[index]!, z: pool.z[index]! };
  const roll = random();
  if (roll < 0.3) {
    pool.originZ[index] = random();
    return setMode(pool, index, HAUL_MODE.look, pickDuration(random, 2, 6));
  }
  if (roll < 0.55) return setMode(pool, index, HAUL_MODE.bask, pickDuration(random, 5, 14));
  const water = roll > 0.85 ? pickWater(context, here, WATER_REACH) : null;
  if (water) return goTo(pool, index, water);
  const shuffle =
    roll > 0.7 ? pickTargetNear(context, here, SHUFFLE_REACH, canHaul(context)) : null;
  if (shuffle) return goTo(pool, index, shuffle);
  setMode(pool, index, HAUL_MODE.lie, pickDuration(random, ...LIE_SECONDS));
};

const chooseInWater = (pool: CritterPool, index: number, context: CritterContext) => {
  const site = context.sites[pool.site[index]!]!;
  const roll = context.random();
  if (roll < 0.3) {
    pool.hidden[index] = 1;
    return setMode(pool, index, HAUL_MODE.under, randomBetween(context.random, ...UNDER_SECONDS));
  }
  const target =
    roll < 0.75
      ? pickWater(context, site, SWIM_RANGE)
      : pickTargetNear(context, site, HAUL_RANGE, canHaul(context));
  if (target) return goTo(pool, index, target);
  startSwim(pool, index, context);
};

/** Back up somewhere near its rocks, a ring where it surfaces. */
const surface = (pool: CritterPool, index: number, context: CritterContext) => {
  const site = context.sites[pool.site[index]!]!;
  const spot = pickWater(context, site, SWIM_RANGE);
  if (!spot) return setMode(pool, index, HAUL_MODE.under, 2);
  pool.x[index] = spot.x;
  pool.z[index] = spot.z;
  pool.hidden[index] = 0;
  pool.originX[index] = 0;
  context.emitRipple(spot.x, spot.z, 0.45);
  startSwim(pool, index, context);
};

const arrive = (pool: CritterPool, index: number, context: CritterContext) => {
  const inWater = isSwimWater(context, pool.x[index]!, pool.z[index]!);
  if (!inWater) {
    pool.originX[index] = 0;
    return setMode(pool, index, HAUL_MODE.lie, pickDuration(context.random, ...LIE_SECONDS));
  }
  if (pool.originX[index] !== 1) return startSwim(pool, index, context);
  context.emitRipple(pool.x[index]!, pool.z[index]!, 0.6);
  pool.hidden[index] = 1;
  setMode(pool, index, HAUL_MODE.under, randomBetween(context.random, ...SCARED_SECONDS));
};

const travel = (pool: CritterPool, index: number, context: CritterContext) => {
  const inWater = isSwimWater(context, pool.x[index]!, pool.z[index]!);
  const fleeing = pool.originX[index] === 1;
  const crawl = fleeing ? FLEE_SPEED : CRAWL_SPEED;
  const speed = inWater ? SWIM_SPEED : crawl;
  steerTowards(pool, index, pool.targetX[index]!, pool.targetZ[index]!, TURN_RATE, context.step);
  pool.speed[index] = speed;
  const moved = moveAround(pool, index, context.step, canMove(context));
  if (!inWater) pool.pose[index] = pool.pose[index]! + (speed * context.step) / CRAWL_CYCLE;
  const near = distanceTo(pool, index, pool.targetX[index]!, pool.targetZ[index]!) < ARRIVED;
  if (!moved || near) arrive(pool, index, context);
};

const checkThreat = (pool: CritterPool, index: number, context: CritterContext) => {
  const mode = pool.mode[index]!;
  if (mode === HAUL_MODE.under || pool.originX[index] === 1) return;
  if (!context.findThreat(pool.x[index]!, pool.z[index]!, THREAT_RADIUS)) return;
  const here = { x: pool.x[index]!, z: pool.z[index]! };
  if (isSwimWater(context, here.x, here.z)) {
    pool.originX[index] = 1;
    return arrive(pool, index, context);
  }
  const water = pickWater(context, here, WATER_REACH * 1.5);
  if (water) goTo(pool, index, water, true);
};

const clipFor = (pool: CritterPool, index: number, context: CritterContext) => {
  const mode = pool.mode[index]!;
  if (isSwimWater(context, pool.x[index]!, pool.z[index]!)) return CLIP.air;
  if (mode === HAUL_MODE.go) return pool.originX[index] === 1 ? CLIP.fast : CLIP.move;
  if (mode === HAUL_MODE.look) return CLIP.look;
  return mode === HAUL_MODE.bask ? CLIP.rest : CLIP.idle;
};

const updatePose = (pool: CritterPool, index: number, context: CritterContext) => {
  const clip = clipFor(pool, index, context);
  if (clip !== pool.clip[index]) pool.pose[index] = clip === CLIP.look ? 0.5 : 0;
  pool.clip[index] = clip;
  const mode = pool.mode[index]!;
  if (mode === HAUL_MODE.look) {
    pool.pose[index] = approach(pool.pose[index]!, pool.originZ[index]!, context.step * 0.8);
  }
  if (mode === HAUL_MODE.bask) pool.pose[index] = approach(pool.pose[index]!, 1, context.step);
};

/** One step of a seal. */
export const updateHauler = (pool: CritterPool, index: number, context: CritterContext) => {
  checkThreat(pool, index, context);
  pool.timer[index] = pool.timer[index]! - context.step;
  const mode = pool.mode[index]!;
  if (mode === HAUL_MODE.go) travel(pool, index, context);
  else if (pool.timer[index]! <= 0) {
    if (mode === HAUL_MODE.under) surface(pool, index, context);
    else if (mode === HAUL_MODE.swim) chooseInWater(pool, index, context);
    else chooseOnLand(pool, index, context);
  }
  updatePose(pool, index, context);
  pool.y[index] = context.terrain.water(pool.x[index]!, pool.z[index]!);
};

export const spawnHauler = (pool: CritterPool, index: number, context: CritterContext) => {
  pool.lift[index] = 0;
  pool.originX[index] = 0;
  pool.clip[index] = CLIP.idle;
  setMode(pool, index, HAUL_MODE.lie, pickDuration(context.random, ...LIE_SECONDS));
};
