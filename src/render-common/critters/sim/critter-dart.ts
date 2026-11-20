import { randomBetween } from "../../../shared/world/rng";
import { CLIP } from "../model/critter-model";
import {
  type CritterContext,
  distanceTo,
  pickDuration,
  pickTargetNear,
  steerTowards} from "./critter-context";
import type { CritterPool } from "./critter-pool";

/**
 * Dragonflies over calm water: they hover on whirring wings, dart off straight and fast to a
 * new spot over the water or along the bank, hover again, and patrol up and down their stretch.
 * A worker coming close makes them dart away. Pool use: target = the next hover spot, lift =
 * height above the water there.
 */
const DART_MODE = { hover: 0, dart: 1 } as const;

const HOVER_SECONDS = [0.4, 2.6] as const;
const HEIGHT = [0.25, 0.7] as const;
const DART_SPEED = 2.2;
const DART_REACH = 1.8;
const WING_RATE = 26;
const TURN_RATE = 9;
const ARRIVED = 0.06;
const THREAT_RADIUS = 1.2;
/** Hover wobble (world units) and its rate. */
const WOBBLE = 0.025;
const WOBBLE_RATE = 5;

/** Over calm water or just beside it (a dragonfly's beat). */
export const canDart = (context: CritterContext) => (x: number, z: number) =>
  context.terrain.depth(x, z) > 0.03 && context.terrain.stillness(x, z) > 0.25;

const startDart = (pool: CritterPool, index: number, context: CritterContext) => {
  const site = context.sites[pool.site[index]!]!;
  const target = pickTargetNear(context, site, DART_REACH, canDart(context));
  if (!target) return hover(pool, index, context);
  pool.targetX[index] = target.x;
  pool.targetZ[index] = target.z;
  pool.lift[index] = randomBetween(context.random, ...HEIGHT);
  pool.mode[index] = DART_MODE.dart;
  pool.timer[index] = 3;
};

const hover = (pool: CritterPool, index: number, context: CritterContext) => {
  pool.mode[index] = DART_MODE.hover;
  pool.timer[index] = pickDuration(context.random, ...HOVER_SECONDS);
  pool.speed[index] = 0;
};

const dart = (pool: CritterPool, index: number, context: CritterContext) => {
  steerTowards(pool, index, pool.targetX[index]!, pool.targetZ[index]!, TURN_RATE, context.step);
  const left = distanceTo(pool, index, pool.targetX[index]!, pool.targetZ[index]!);
  const travel = Math.min(left, DART_SPEED * context.step);
  pool.x[index] = pool.x[index]! + Math.cos(pool.heading[index]!) * travel;
  pool.z[index] = pool.z[index]! + Math.sin(pool.heading[index]!) * travel;
  if (left - travel < ARRIVED) hover(pool, index, context);
};

/** One step of a dragonfly. */
export const updateDarter = (pool: CritterPool, index: number, context: CritterContext) => {
  pool.timer[index] = pool.timer[index]! - context.step;
  const threat = context.findThreat(pool.x[index]!, pool.z[index]!, THREAT_RADIUS);
  if (pool.mode[index] === DART_MODE.dart) dart(pool, index, context);
  else if (pool.timer[index]! <= 0 || threat) startDart(pool, index, context);
  const wobble = Math.sin(context.time * WOBBLE_RATE + pool.seed[index]! * 30) * WOBBLE;
  const x = pool.x[index]!, z = pool.z[index]!;
  pool.y[index] = context.terrain.water(x, z) + pool.lift[index]! + wobble;
  pool.clip[index] = CLIP.fly;
  pool.pose[index] = pool.pose[index]! + context.step * WING_RATE;
};

export const spawnDarter = (pool: CritterPool, index: number, context: CritterContext) => {
  pool.lift[index] = randomBetween(context.random, ...HEIGHT);
  pool.clip[index] = CLIP.fly;
  hover(pool, index, context);
};
