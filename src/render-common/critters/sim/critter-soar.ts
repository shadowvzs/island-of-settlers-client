import { randomBetween } from "../../../shared/world/rng";
import { CLIP } from "../model/critter-model";
import { type CritterContext,pickDuration } from "./critter-context";
import type { CritterPool } from "./critter-pool";

/**
 * Eagles soaring over the peaks: wide banked circles high above the summit, a few slow wing
 * beats now and then, the circle widening or tightening (re-centred on the bird, so it never
 * jumps) while it stays over its peak. Pool use: target = circle centre, originX = angle on
 * the circle, originZ = radius, lift = height above the peak, clock = time to the next change.
 */
export const SOAR_MODE = { glide: 0, flap: 1 } as const;

const SPEED = 1.5;
const RADIUS = [2.6, 5.5] as const;
const HEIGHT = [3, 4.6] as const;
const GLIDE_SECONDS: readonly [number, number] = [7, 18];
const FLAP_SECONDS: readonly [number, number] = [1.2, 2.4];
const CHANGE_SECONDS = [14, 35] as const;
const FLAP_RATE = 2;
/** Share of the full baked bank held in a steady circle. */
const BANK_SHARE = 0.85;
/** Gentle rise and fall of the soaring height (world units, radians per second). */
const BOB = 0.35;
const BOB_RATE = 0.35;
const RADIUS_TRIES = 3;

/** Circles counter clockwise (+1, banked left) or clockwise (-1), fixed per bird. */
const getDirection = (pool: CritterPool, index: number) => (pool.seed[index]! < 0.5 ? 1 : -1);

/** A new radius whose centre (re-centred on the bird) lies closest to the peak. */
const changeCircle = (pool: CritterPool, index: number, context: CritterContext) => {
  const site = context.sites[pool.site[index]!]!;
  const angle = pool.originX[index]!;
  let best = Infinity;
  for (let attempt = 0; attempt < RADIUS_TRIES; attempt += 1) {
    const radius = randomBetween(context.random, ...RADIUS);
    const centreX = pool.x[index]! - Math.cos(angle) * radius;
    const centreZ = pool.z[index]! - Math.sin(angle) * radius;
    const distance = Math.hypot(centreX - site.x, centreZ - site.z);
    if (distance >= best) continue;
    best = distance;
    pool.originZ[index] = radius;
    pool.targetX[index] = centreX;
    pool.targetZ[index] = centreZ;
  }
  pool.clock[index] = pickDuration(context.random, ...CHANGE_SECONDS);
};

const switchWings = (pool: CritterPool, index: number, context: CritterContext) => {
  const flapping = pool.mode[index] === SOAR_MODE.glide;
  pool.mode[index] = flapping ? SOAR_MODE.flap : SOAR_MODE.glide;
  pool.timer[index] = randomBetween(context.random, ...(flapping ? FLAP_SECONDS : GLIDE_SECONDS));
};

const setWingClip = (pool: CritterPool, index: number, context: CritterContext) => {
  if (pool.mode[index] === SOAR_MODE.flap) {
    if (pool.clip[index] !== CLIP.fly) pool.pose[index] = 0;
    pool.clip[index] = CLIP.fly;
    pool.pose[index] = pool.pose[index]! + context.step * FLAP_RATE;
    return;
  }
  pool.clip[index] = CLIP.air;
  pool.pose[index] = 0.5 + getDirection(pool, index) * 0.5 * BANK_SHARE;
};

/** One step of a soaring eagle. */
export const updateSoarer = (pool: CritterPool, index: number, context: CritterContext) => {
  const direction = getDirection(pool, index);
  const radius = pool.originZ[index]!;
  const angle = pool.originX[index]! + (direction * SPEED * context.step) / radius;
  pool.originX[index] = angle;
  pool.x[index] = pool.targetX[index]! + Math.cos(angle) * radius;
  pool.z[index] = pool.targetZ[index]! + Math.sin(angle) * radius;
  pool.heading[index] = angle + (direction * Math.PI) / 2;
  const site = context.sites[pool.site[index]!]!;
  const bob = Math.sin(context.time * BOB_RATE + pool.seed[index]! * 40) * BOB;
  pool.y[index] = context.terrain.ground(site.x, site.z) + pool.lift[index]! + bob;
  pool.timer[index] = pool.timer[index]! - context.step;
  if (pool.timer[index]! <= 0) switchWings(pool, index, context);
  pool.clock[index] = pool.clock[index]! - context.step;
  if (pool.clock[index]! <= 0) changeCircle(pool, index, context);
  setWingClip(pool, index, context);
};

export const spawnSoarer = (pool: CritterPool, index: number, context: CritterContext) => {
  const { random } = context;
  const radius = randomBetween(random, ...RADIUS);
  const angle = random() * Math.PI * 2;
  pool.originX[index] = angle;
  pool.originZ[index] = radius;
  pool.targetX[index] = pool.x[index]! - Math.cos(angle) * radius;
  pool.targetZ[index] = pool.z[index]! - Math.sin(angle) * radius;
  pool.lift[index] = randomBetween(random, ...HEIGHT);
  pool.mode[index] = SOAR_MODE.glide;
  pool.timer[index] = randomBetween(random, ...GLIDE_SECONDS);
  pool.clock[index] = pickDuration(random, ...CHANGE_SECONDS);
  pool.clip[index] = CLIP.air;
};

/** Eagles start anywhere around their peak (in the air). */
export const canSoar = () => () => true;
