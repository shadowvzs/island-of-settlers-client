import { clamp, lerp } from "../../shared/world/noise";
import type { Random } from "../../shared/world/rng";
import { randomInRange } from "../../shared/world/rng";
import {
  approach,
  getSteerTurn,
  smoothingFactor,
  steerHeading,
  wrapAngle
} from "../birds/bird-flight";
import { getBob, getLateralSpeed, getWanderTurn } from "./butterfly-flight";
import {
  avoidObstacles,
  type ButterflyField,
  findFlower,
  getFlowerTop,
  scoreSpeciesZone} from "./butterfly-habitat";
import { BUTTERFLY_MODE, type ButterflyPool } from "./butterfly-pool";
import { BUTTERFLY_SPECIES, type ButterflySpecies } from "./butterfly-species";

const TAU = Math.PI * 2;
/** Beyond this distance from home the wander bends back (world units). */
const LEASH = 5;
const HOME_TURN = 2.4;
const AVOID_TURN = 4;
const APPROACH_TURN = 4.5;
/** Habitat score ahead below which it turns back home. */
const POOR_HABITAT = 0.08;
const LOOK_AHEAD = 1.5;
/** Flowers this close are landing targets; landing ends this close above the flower. */
const LAND_RADIUS = 3.5;
const LAND_REACH = 0.1;
const MIN_CLEARANCE = 0.15;
/** Seconds: flight before a landing try, sitting, an approach before giving up. */
const FLY_TIME: readonly [number, number] = [5, 13];
const RETRY_TIME: readonly [number, number] = [2, 5];
const SIT_TIME: readonly [number, number] = [3, 9];
const APPROACH_LIMIT = 6;
/** Slow basking open / close while sitting (cycles per second). */
const SIT_FLAP_RATE = 0.3;

export interface ButterflyContext {
  field: ButterflyField;
  random: Random;
  step: number;
  time: number;
}

/** Steering back home: when past the leash or when the habitat ahead is poor. */
const getHomeTurn = (pool: ButterflyPool, index: number, context: ButterflyContext) => {
  const species = BUTTERFLY_SPECIES[pool.species[index]!]!;
  const x = pool.x[index]!;
  const z = pool.z[index]!;
  const heading = pool.heading[index]!;
  const dx = pool.homeX[index]! - x;
  const dz = pool.homeZ[index]! - z;
  const leash = clamp((Math.hypot(dx, dz) - LEASH) / 2, 0, 1);
  const aheadX = x + Math.cos(heading) * LOOK_AHEAD;
  const aheadZ = z + Math.sin(heading) * LOOK_AHEAD;
  const poor = scoreSpeciesZone(context.field, species, aheadX, aheadZ) < POOR_HABITAT ? 1 : 0;
  const weight = Math.max(leash, poor);
  if (weight === 0) return 0;
  return getSteerTurn(heading, Math.atan2(dz, dx), HOME_TURN) * weight;
};

/** Moves along the heading plus a side sway, then out of trunks, stones and shrubs. */
const move = (
  pool: ButterflyPool,
  index: number,
  context: ButterflyContext,
  speed: number,
  lateral: number
) => {
  const heading = pool.heading[index]!;
  const forwardX = Math.cos(heading);
  const forwardZ = Math.sin(heading);
  const x = pool.x[index]! + (forwardX * speed - forwardZ * lateral) * context.step;
  const z = pool.z[index]! + (forwardZ * speed + forwardX * lateral) * context.step;
  const avoid = avoidObstacles(context.field, x, pool.y[index]!, z);
  pool.x[index] = avoid.x;
  pool.z[index] = avoid.z;
  if (avoid.pushed) {
    const away = Math.atan2(avoid.z - z, avoid.x - x);
    pool.heading[index] = steerHeading(heading, away, AVOID_TURN, context.step);
  }
  return avoid.floor;
};

/** Eases towards `target` height, never below the ground (looked ahead) or an obstacle top. */
const updateHeight = (
  pool: ButterflyPool,
  index: number,
  context: ButterflyContext,
  target: number,
  floor: number
) => {
  const { surface } = context.field.habitat;
  const x = pool.x[index]!;
  const z = pool.z[index]!;
  const heading = pool.heading[index]!;
  const ahead = surface(x + Math.cos(heading) * 0.8, z + Math.sin(heading) * 0.8);
  const ground = Math.max(surface(x, z), ahead);
  const height = Math.max(target, ground + MIN_CLEARANCE);
  const eased = lerp(pool.y[index]!, height, smoothingFactor(2.5, context.step));
  pool.y[index] = Math.max(eased, ground + MIN_CLEARANCE, floor);
  return ground;
};

/** Beating stretches with the odd glide on flat wings (species dependent). */
const updateFlap = (
  pool: ButterflyPool,
  index: number,
  context: ButterflyContext,
  species: ButterflySpecies
) => {
  const { random, step } = context;
  pool.glideTimer[index]! -= step;
  if (pool.glideTimer[index]! <= 0) {
    const glide = pool.flap[index]! > 0.5 && random() < species.glide;
    pool.glideTimer[index] = glide ? 0.4 + random() * 0.8 : 0.8 + random() * 1.8;
    pool.gliding[index] = glide ? 1 : 0;
  }
  const gliding = pool.mode[index] === BUTTERFLY_MODE.fly && pool.gliding[index] === 1;
  const target = gliding ? 0 : 1;
  pool.flap[index] = approach(pool.flap[index]!, target, step * 6);
  const rate = species.flapRate * (0.3 + 0.7 * pool.flap[index]!);
  pool.phase[index] = wrapAngle(pool.phase[index]! + TAU * rate * step);
};

export const isFlowerTaken = (pool: ButterflyPool, flower: number) => {
  for (let index = 0; index < pool.capacity; index += 1)
    if (pool.active[index] === 1 && pool.flower[index] === flower) return true;
  return false;
};

/** Looks for a free flower nearby; found: approach it, else try again a bit later. */
const tryLanding = (pool: ButterflyPool, index: number, context: ButterflyContext) => {
  const { field, random } = context;
  const x = pool.x[index]!;
  const z = pool.z[index]!;
  const flower = findFlower(field, x, z, LAND_RADIUS, pool.lastFlower[index]!);
  if (flower < 0 || isFlowerTaken(pool, flower)) {
    pool.timer[index] = randomInRange(random, RETRY_TIME);
    return;
  }
  const { props } = field.world;
  pool.flower[index] = flower;
  pool.targetX[index] = props.x[flower]! + (random() - 0.5) * 0.12;
  pool.targetZ[index] = props.z[flower]! + (random() - 0.5) * 0.12;
  pool.mode[index] = BUTTERFLY_MODE.approach;
  pool.timer[index] = APPROACH_LIMIT;
};

/** Back to wandering flight (after sitting or a failed approach). */
export const startFlying = (pool: ButterflyPool, index: number, random: Random) => {
  pool.mode[index] = BUTTERFLY_MODE.fly;
  pool.lastFlower[index] = pool.flower[index]!;
  pool.flower[index] = -1;
  pool.timer[index] = randomInRange(random, FLY_TIME);
  pool.gliding[index] = 0;
};

/** Settles on the flower it approaches (also used to spawn some butterflies sitting). */
export const startSitting = (pool: ButterflyPool, index: number, context: ButterflyContext) => {
  const flower = pool.flower[index]!;
  pool.mode[index] = BUTTERFLY_MODE.sit;
  pool.x[index] = pool.targetX[index]!;
  pool.z[index] = pool.targetZ[index]!;
  pool.y[index] = getFlowerTop(context.field.world, flower);
  pool.timer[index] = randomInRange(context.random, SIT_TIME);
};

const fly = (pool: ButterflyPool, index: number, context: ButterflyContext) => {
  const { step, time } = context;
  const species = BUTTERFLY_SPECIES[pool.species[index]!]!;
  const seed = pool.seed[index]!;
  const turn = getWanderTurn(time, seed) + getHomeTurn(pool, index, context);
  pool.heading[index] = wrapAngle(pool.heading[index]! + turn * step);
  const speed = pool.speed[index]! * (0.8 + 0.3 * Math.sin(time * 1.3 + seed * 2.9));
  const floor = move(pool, index, context, speed, getLateralSpeed(time, seed));
  const bob = getBob(time, seed, pool.phase[index]!);
  const ground = context.field.habitat.surface(pool.x[index]!, pool.z[index]!);
  updateHeight(pool, index, context, ground + pool.cruise[index]! + bob, floor);
  pool.sit[index] = approach(pool.sit[index]!, 0, step * 4);
  updateFlap(pool, index, context, species);
  pool.timer[index]! -= step;
  if (pool.timer[index]! <= 0) tryLanding(pool, index, context);
};

/** Turns towards the flower, slows and sinks onto it; gives up when it takes too long. */
const approachFlower = (pool: ButterflyPool, index: number, context: ButterflyContext) => {
  const { random, step, time } = context;
  const species = BUTTERFLY_SPECIES[pool.species[index]!]!;
  const dx = pool.targetX[index]! - pool.x[index]!;
  const dz = pool.targetZ[index]! - pool.z[index]!;
  const distance = Math.hypot(dx, dz);
  const heading = steerHeading(pool.heading[index]!, Math.atan2(dz, dx), APPROACH_TURN, step);
  pool.heading[index] = heading;
  const near = clamp(distance / 1.5, 0, 1);
  const speed = Math.min(pool.speed[index]! * (0.35 + 0.65 * near), distance / step);
  const floor = move(pool, index, context, speed, getLateralSpeed(time, pool.seed[index]!) * near);
  const top = getFlowerTop(context.field.world, pool.flower[index]!);
  const ground = context.field.habitat.surface(pool.x[index]!, pool.z[index]!);
  const cruise = ground + pool.cruise[index]!;
  updateHeight(pool, index, context, lerp(top + 0.02, cruise, near), Math.min(floor, top));
  updateFlap(pool, index, context, species);
  pool.timer[index]! -= step;
  if (distance < LAND_REACH && pool.y[index]! - top < 0.12) startSitting(pool, index, context);
  else if (pool.timer[index]! <= 0) startFlying(pool, index, random);
};

/** Sits still with the wings slowly opening and closing, then takes off in a new direction. */
const sit = (pool: ButterflyPool, index: number, context: ButterflyContext) => {
  const { random, step } = context;
  pool.sit[index] = approach(pool.sit[index]!, 1, step * 3);
  pool.flap[index] = approach(pool.flap[index]!, 0, step * 3);
  pool.phase[index] = wrapAngle(pool.phase[index]! + TAU * SIT_FLAP_RATE * step);
  pool.timer[index]! -= step;
  if (pool.timer[index]! > 0) return;
  pool.heading[index] = wrapAngle(pool.heading[index]! + (random() - 0.5) * 3);
  startFlying(pool, index, random);
};

/** One fixed step of one butterfly. */
export const updateButterfly = (pool: ButterflyPool, index: number, context: ButterflyContext) => {
  const mode = pool.mode[index];
  if (mode === BUTTERFLY_MODE.sit) sit(pool, index, context);
  else if (mode === BUTTERFLY_MODE.approach) approachFlower(pool, index, context);
  else fly(pool, index, context);
};
