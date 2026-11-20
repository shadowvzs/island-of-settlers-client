import { DMath } from "../../../shared/math/deterministic-math";
import { fract, smoothstep } from "../../../shared/world/noise";
import { getDeathProgress } from "../../helpers";
import type { AnimalMotion } from "../model/animal-pose";
import { wrapAngle } from "../nav/nav-steering";
import { ANIMAL_STATE, getSpecies, type SpeciesProfile } from "../wildlife-species";
import { getAntlerScale } from "./animal-age";
import type { AnimalMotionPool, AnimalPool } from "./animal-pool";
import type { WildlifeContext } from "./wildlife-context";
import { easeToward } from "./wildlife-context";

const EAR_KICK = 0.55;
/** Spreads slot numbers over 0 .. 1 (the individual seed of idle variation). */
const GOLDEN_RATIO = 0.618034;
const EAR_RELAX = 9;
/** Head high posture per state: full when alert, partly while calming down. */
const ALERT_POSTURE: Partial<Record<number, number>> = {
  [ANIMAL_STATE.alert]: 1,
  [ANIMAL_STATE.recover]: 0.45
};

/** Scratch gait weights (no allocation). */
const gait = { run: 0, stride: 1, trot: 0 };

/**
 * Gait blend by speed: walk up to the walking speed, then trot, then run; the stride follows
 * the same blend, so the cycle (speed / stride) always matches the ground speed.
 */
const getGaitBlend = (profile: SpeciesProfile, speed: number, size: number) => {
  const { run, trot, walk } = profile;
  gait.trot = 0;
  gait.run = 0;
  gait.stride = walk.stride;
  if (speed > walk.speed && speed <= trot.speed) {
    gait.trot = (speed - walk.speed) / (trot.speed - walk.speed);
    gait.stride = walk.stride + (trot.stride - walk.stride) * gait.trot;
  } else if (speed > trot.speed) {
    gait.run = Math.min(1, (speed - trot.speed) / (run.speed - trot.speed));
    gait.trot = 1 - gait.run;
    gait.stride = trot.stride + (run.stride - trot.stride) * gait.run;
  }
  gait.stride *= size;
  return gait;
};

const updateHead = (
  pool: AnimalPool,
  motion: AnimalMotionPool,
  animal: number,
  context: WildlifeContext,
  dt: number
) => {
  const state = pool.state[animal]!;
  const looking =
    state === ANIMAL_STATE.look || state === ANIMAL_STATE.recover || state === ANIMAL_STATE.rest;
  motion.lookTimer[animal]! -= dt;
  if (looking && motion.lookTimer[animal]! <= 0) {
    motion.lookTimer[animal] = 0.6 + context.visualRandom() * 1.4;
    motion.headYawTarget[animal] = (context.visualRandom() * 2 - 1) * 0.9;
  }
  const watching = looking || state === ANIMAL_STATE.alert;
  if (!watching) {
    const turning = pool.speed[animal]! > 0.02 && context.motion.rest[animal]! < 0.15;
    const difference = wrapAngle(pool.desiredHeading[animal]! - pool.heading[animal]!);
    motion.headYawTarget[animal] = turning ? Math.max(-0.45, Math.min(0.45, difference)) : 0;
  }
  motion.headYaw[animal] = easeToward(motion.headYaw[animal]!, motion.headYawTarget[animal]!, 3, dt);
};

/** Largest lean into a turn (radians) at full gallop, and the heading error that reaches it. */
const LEAN_MAX = 0.13;
const LEAN_TURN = 0.6;
const LEAN_RATE = 4;

/**
 * Lean into a turn (the body tilts towards the inside of the curve, more the faster it runs):
 * a positive heading change turns left (+z), so the roll leans negative.
 */
const updateLean = (
  pool: AnimalPool,
  motion: AnimalMotionPool,
  animal: number,
  speedShare: number,
  dt: number
) => {
  const turn = wrapAngle(pool.desiredHeading[animal]! - pool.heading[animal]!);
  const bend = Math.max(-1, Math.min(1, turn / LEAN_TURN));
  const target = -LEAN_MAX * bend * Math.min(1, speedShare);
  motion.lean[animal] = easeToward(motion.lean[animal]!, target, LEAN_RATE, dt);
};

/** Independent ear flicks at random intervals (more often when alert). */
const updateEars = (
  pool: AnimalPool,
  motion: AnimalMotionPool,
  animal: number,
  context: WildlifeContext,
  dt: number
) => {
  motion.earTimer[animal]! -= dt;
  motion.earLeft[animal] = easeToward(motion.earLeft[animal]!, 0, EAR_RELAX, dt);
  motion.earRight[animal] = easeToward(motion.earRight[animal]!, 0, EAR_RELAX, dt);
  if (motion.earTimer[animal]! > 0) return;
  const alert = pool.state[animal] === ANIMAL_STATE.alert;
  motion.earTimer[animal] = (alert ? 0.4 : 1.2) + context.visualRandom() * (alert ? 1.2 : 4.5);
  const kick = (context.visualRandom() < 0.5 ? -1 : 1) * EAR_KICK;
  if (context.visualRandom() < 0.5) motion.earLeft[animal] = kick;
  else motion.earRight[animal] = kick;
};

/** A bedded animal counts as up on its legs (it may move) below this rest fold. */
const RISEN = 0.15;

/** Whether the animal stands (almost) up: it may move, and is no longer a lying body. */
export const isRisen = (motion: AnimalMotionPool, animal: number) => motion.rest[animal]! < RISEN;

/** States that keep an animal bedded (it rises for anything else). */
const isBedded = (state: number) => state === ANIMAL_STATE.rest;
/** Rising is quicker than lying down, and much quicker when alarmed. */
const RISE_SPEED = 1.6;
const ALARMED_RISE = 2.6;
/** Seconds between switches of the bedded head pose (upright / lowered), per animal. */
const REST_HEAD_PERIOD = 40;

/** Share of the rest fold a species rises per second (calm or alarmed). */
export const getRiseRate = (species: number, alarmed: boolean) =>
  (RISE_SPEED * (alarmed ? ALARMED_RISE : 1)) / getSpecies(species).lieDown;

/**
 * Simulation: lying down and rising through the leg folds at the species' pace (`rest` gates
 * locomotion, so it steps with the settlement tick). An animal lies down only once it has
 * stopped: it never slides over the ground while folding its legs.
 */
export const stepRest = (context: WildlifeContext, animal: number, dt: number) => {
  const { motion, pool } = context;
  const species = pool.species[animal]!;
  const state = pool.state[animal]!;
  const bedded = isBedded(state);
  if (bedded && pool.speed[animal]! > 0) return;
  const alarmed = state === ANIMAL_STATE.alert || state === ANIMAL_STATE.flee;
  const rate = bedded ? 1 / getSpecies(species).lieDown : getRiseRate(species, alarmed);
  const target = bedded ? 1 : 0;
  const step = Math.sign(target - motion.rest[animal]!) * rate * dt;
  motion.rest[animal] = Math.min(1, Math.max(0, motion.rest[animal]! + step));
};

/** The bedded head pose changes now and then (upright or lowered), always up when alarmed. */
const updateRestHead = (context: WildlifeContext, animal: number, dt: number) => {
  const { motion, pool } = context;
  const state = pool.state[animal]!;
  const alarmed = state === ANIMAL_STATE.alert || state === ANIMAL_STATE.flee;
  const wave = DMath.sin((context.time / REST_HEAD_PERIOD) * Math.PI * 2 + animal * 1.7);
  const calm = isBedded(state) && !alarmed && pool.alertLevel[animal]! < 0.3;
  const headLow = calm && wave > 0.2 ? 1 : 0;
  motion.restHead[animal] = easeToward(motion.restHead[animal]!, headLow, 0.8, dt);
};

/** Fresh visual phases and timers (birth or load), from the visual stream only. */
export const initVisualMotion = (context: WildlifeContext, animal: number) => {
  const { motion, visualRandom } = context;
  motion.gaitPhase[animal] = visualRandom();
  motion.breath[animal] = visualRandom() * 6.3;
  motion.chew[animal] = visualRandom() * 6.3;
  motion.earTimer[animal] = visualRandom() * 3;
  motion.lookTimer[animal] = visualRandom();
  motion.graze[animal] = 0;
  motion.alert[animal] = 0;
  motion.flee[animal] = 0;
  motion.headYaw[animal] = 0;
  motion.headYawTarget[animal] = 0;
  motion.lean[animal] = 0;
  motion.restHead[animal] = 0;
};

/**
 * Renderer only, per drawn animal and frame: gait phase from the distance covered, grazing,
 * alert and flight postures, head turns, ear flicks, breathing, chewing. Never read by the
 * simulation, so the camera and frame rate cannot change gameplay.
 */
export const animateVisual = (context: WildlifeContext, animal: number, dt: number) => {
  const { motion, pool } = context;
  const profile = getSpecies(pool.species[animal]!);
  const state = pool.state[animal]!;
  const speed = DMath.hypot(pool.velocityX[animal]!, pool.velocityZ[animal]!);
  const blend = getGaitBlend(profile, speed / pool.speedFactor[animal]!, pool.bodyScale[animal]!);
  motion.gaitPhase[animal]! += (speed * dt) / blend.stride;
  motion.graze[animal] = easeToward(
    motion.graze[animal]!,
    state === ANIMAL_STATE.graze ? 1 : 0,
    1.6,
    dt
  );
  motion.alert[animal] = easeToward(motion.alert[animal]!, ALERT_POSTURE[state] ?? 0, 3.5, dt);
  motion.flee[animal] = easeToward(motion.flee[animal]!, state === ANIMAL_STATE.flee ? 1 : 0, 3, dt);
  updateRestHead(context, animal, dt);
  updateHead(pool, motion, animal, context, dt);
  updateEars(pool, motion, animal, context, dt);
  updateLean(pool, motion, animal, speed / (profile.run.speed * pool.speedFactor[animal]!), dt);
  const panting = 1 + pool.alertLevel[animal]! * 1.5;
  motion.breath[animal]! += dt * 2.2 * panting;
  motion.chew[animal]! += dt * 7 * motion.graze[animal]!;
};

/** Fills an AnimalMotion for the pose from the smoothed parameters of a slot. */
export const readMotion = (context: WildlifeContext, animal: number, target: AnimalMotion) => {
  const { motion, pool } = context;
  const profile = getSpecies(pool.species[animal]!);
  const speed = DMath.hypot(pool.velocityX[animal]!, pool.velocityZ[animal]!) / pool.speedFactor[animal]!;
  const blend = getGaitBlend(profile, speed, pool.bodyScale[animal]!);
  target.alert = motion.alert[animal]!;
  target.antlers = getAntlerScale(pool, animal);
  target.breath = motion.breath[animal]!;
  target.chew = motion.chew[animal]!;
  target.death = pool.carcass[animal] ? getDeathProgress(pool.deathTime[animal]!) : 0;
  target.earLeft = motion.earLeft[animal]! + motion.earLeftBase[animal]!;
  target.earRight = motion.earRight[animal]! + motion.earRightBase[animal]!;
  target.restKind = motion.restKind[animal]!;
  target.flee = motion.flee[animal]!;
  target.gaitPhase = motion.gaitPhase[animal]!;
  target.graze = motion.graze[animal]!;
  target.headYaw = motion.headYaw[animal]!;
  target.lean = motion.lean[animal]!;
  // The gait never plays on folded legs: a bedded animal does not walk (it rises first).
  target.move = smoothstep(0, profile.walk.speed * 0.5, speed) * (1 - motion.rest[animal]!);
  target.rest = motion.rest[animal]!;
  target.restHead = motion.restHead[animal]!;
  target.run = blend.run;
  target.seed = fract(animal * GOLDEN_RATIO);
  target.trot = blend.trot;
  return target;
};
