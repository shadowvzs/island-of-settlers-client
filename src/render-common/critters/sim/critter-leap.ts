import { randomBetween } from "../../../shared/world/rng";
import { CLIP } from "../model/critter-model";
import { type CritterContext,pickDuration, pickTargetNear } from "./critter-context";
import type { CritterPool } from "./critter-pool";

/**
 * Fish leaping out of rivers and the sea: unseen under the water most of the time, now and then
 * one jumps a short arc (nose up out of the water, level at the top, nose down back in) with a
 * ring where it leaves and a bigger splash where it lands. More leaps at dawn and dusk.
 */
const LEAP_MODE = { under: 0, air: 1 } as const;

const LEAP_INTERVAL = [7, 26] as const;
const LEAP_SECONDS = [0.7, 1] as const;
const LEAP_DISTANCE = [0.6, 1.15] as const;
const LEAP_HEIGHT = [0.3, 0.55] as const;
/** Steepest pitch of the baked frames (the `air` clip spans -PITCH .. PITCH). */
const PITCH = 1.05;
const MIN_DEPTH = 0.22;

export const canLeapFrom = (context: CritterContext) => (x: number, z: number) =>
  context.terrain.depth(x, z) > MIN_DEPTH;

/** Twilight feeding: leaps come more often around dawn and dusk. */
const getIntervalScale = (daylight: number) => (daylight > 0.15 && daylight < 0.7 ? 0.6 : 1);

const waitUnder = (pool: CritterPool, index: number, context: CritterContext) => {
  pool.mode[index] = LEAP_MODE.under;
  pool.hidden[index] = 1;
  const seconds = pickDuration(context.random, ...LEAP_INTERVAL);
  pool.timer[index] = seconds * getIntervalScale(context.daylight);
};

const startLeap = (pool: CritterPool, index: number, context: CritterContext) => {
  const site = context.sites[pool.site[index]!]!;
  const start = pickTargetNear(context, site, 1.6, canLeapFrom(context));
  if (!start) return waitUnder(pool, index, context);
  const { random } = context;
  pool.mode[index] = LEAP_MODE.air;
  pool.hidden[index] = 0;
  pool.heading[index] = random() * Math.PI * 2;
  pool.originX[index] = start.x;
  pool.originZ[index] = start.z;
  pool.speed[index] = randomBetween(random, ...LEAP_DISTANCE);
  pool.lift[index] = randomBetween(random, ...LEAP_HEIGHT);
  pool.timer[index] = randomBetween(random, ...LEAP_SECONDS);
  pool.clock[index] = pool.timer[index]!;
  pool.x[index] = start.x;
  pool.z[index] = start.z;
  context.emitRipple(start.x, start.z, 0.22);
};

/** Position on the arc and the pitch of its tangent (as the `air` clip amount). */
const flyArc = (pool: CritterPool, index: number, context: CritterContext) => {
  const duration = pool.clock[index]!;
  const t = Math.min(1, 1 - pool.timer[index]! / duration);
  const distance = pool.speed[index]!;
  const height = pool.lift[index]!;
  const x = pool.originX[index]! + Math.cos(pool.heading[index]!) * distance * t;
  const z = pool.originZ[index]! + Math.sin(pool.heading[index]!) * distance * t;
  pool.x[index] = x;
  pool.z[index] = z;
  pool.y[index] = context.terrain.water(x, z) + 4 * height * t * (1 - t) - 0.04;
  const pitch = Math.atan2(4 * height * (1 - 2 * t), distance);
  pool.pose[index] = Math.min(1, Math.max(0, (pitch / PITCH + 1) / 2));
  return t;
};

/** One step of a leaping fish. */
export const updateLeaper = (pool: CritterPool, index: number, context: CritterContext) => {
  pool.timer[index] = pool.timer[index]! - context.step;
  pool.clip[index] = CLIP.air;
  if (pool.mode[index] === LEAP_MODE.under) {
    if (pool.timer[index]! <= 0) startLeap(pool, index, context);
    return;
  }
  const t = flyArc(pool, index, context);
  if (t < 1) return;
  context.emitRipple(pool.x[index]!, pool.z[index]!, 0.38);
  waitUnder(pool, index, context);
};

export const spawnLeaper = (pool: CritterPool, index: number, context: CritterContext) => {
  waitUnder(pool, index, context);
  pool.timer[index] = pool.timer[index]! * context.random();
  pool.lift[index] = 0;
};
