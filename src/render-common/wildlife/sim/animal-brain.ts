import { DMath } from "../../../shared/math/deterministic-math";
import { pickWeighted, randomInRange } from "../../../shared/world/rng";
import { isRestSpotValid } from "../nav/nav-query";
import { getSeparation, steerHeading, wrapAngle } from "../nav/nav-steering";
import {
  ANIMAL_STATE,
  type AnimalState,
  getSpecies,
  SPECIES,
  type SpeciesProfile
} from "../wildlife-species";
import { isYoung } from "./animal-age";
import { thinkHuntedAnimal } from "./animal-hunting";
import { REACTION } from "./animal-pool";
import { startEscape, startWanderLeg } from "./animal-targets";
import {
  clearRoute,
  getWaypointX,
  getWaypointZ,
  hasRoute,
  pickDuration,
  planRoute,
  type WildlifeContext
} from "./wildlife-context";

/** Chance per second that a calm walk ends early (natural stops, not robotic legs). */
const EARLY_STOP_RATE = 0.06;
/** Blocked this long (no move or turn fits), the animal gives the leg up and stands. */
const STUCK_SECONDS = 1.5;
/** Rabbit rest kinds (sit, loaf, crouch, groom): weights. */
const RABBIT_REST_WEIGHTS = [0.32, 0.36, 0.17, 0.15];
/** Seconds between re-evaluations of a flight. */
const FLEE_REVIEW = 1.2;
/** Herd mates react to an alarmed animal after this delay range (seconds). */
const HERD_DELAY = [0.15, 0.6] as const;
/** Second hand alarms arrive weaker. */
const HERD_INTENSITY = 0.85;
/** Followers further than this many personal spaces from the leader walk back. */
const FOLLOW_DISTANCE = 3.2;
/** The young follow their mother within a couple of body lengths (2 to 8 m). */
const YOUNG_FOLLOW_DISTANCE = 1.8;
/** How much more the young rest. */
const YOUNG_REST = 3;
/** Trot instead of walk for longer legs (deer and elk). */
const TROT_LEG = 4;
const MOVING_STATES = new Set<number>([ANIMAL_STATE.walk, ANIMAL_STATE.trot, ANIMAL_STATE.flee]);

export const isMovingState = (state: number) => MOVING_STATES.has(state);

export const setState = (
  context: WildlifeContext,
  animal: number,
  state: AnimalState,
  length: number
) => {
  const { pool } = context;
  pool.state[animal] = state;
  pool.stateTime[animal] = 0;
  pool.stateLength[animal] = length;
  if (!isMovingState(state)) clearRoute(pool, animal);
};

const getLeaderDistance = (context: WildlifeContext, animal: number) => {
  const { pool } = context;
  const leader = pool.group[animal]!;
  if (leader === animal || !pool.active[leader] || pool.pending[leader]) return 0;
  return DMath.hypot(pool.x[leader]! - pool.x[animal]!, pool.z[leader]! - pool.z[animal]!);
};

/** Starts a walk (or a trot for long legs of deer and elk); false when no leg was found. */
const startWalk = (context: WildlifeContext, animal: number, follow: boolean) => {
  const { pool, random } = context;
  if (!startWanderLeg(context, animal, follow)) return false;
  const length = DMath.hypot(
    pool.targetX[animal]! - pool.x[animal]!,
    pool.targetZ[animal]! - pool.z[animal]!
  );
  const trots = pool.species[animal] !== 0 && length > TROT_LEG &&
    random.at("wildlife.trot", animal)() < 0.35;
  const state = trots ? ANIMAL_STATE.trot : ANIMAL_STATE.walk;
  setState(context, animal, state, Infinity);
  pool.desiredHeading[animal] = DMath.atan2(
    getWaypointZ(pool, animal) - pool.z[animal]!,
    getWaypointX(pool, animal) - pool.x[animal]!
  );
  return true;
};

/**
 * Weighted pick of the next calm activity; walking right after a walk is less likely, the
 * young rest much more (a newborn fawn stays bedded and hidden while its mother grazes).
 */
const pickCalmState = (
  context: WildlifeContext,
  animal: number,
  profile: SpeciesProfile,
  afterMove: boolean
) => {
  const { calm } = profile;
  const young = isYoung(context.pool, animal);
  const walk = afterMove ? calm.walk * 0.25 : calm.walk;
  const rest = calm.rest * (young ? YOUNG_REST : 1) * context.pool.restBias[animal]!;
  const total = calm.graze + calm.idle + calm.look + rest + walk;
  let roll = context.random.at("wildlife.calmState", animal)() * total;
  roll -= rest;
  if (roll < 0) return ANIMAL_STATE.rest;
  roll -= calm.graze;
  if (roll < 0) return ANIMAL_STATE.graze;
  roll -= calm.idle;
  if (roll < 0) return ANIMAL_STATE.idle;
  roll -= calm.look;
  if (roll < 0) return ANIMAL_STATE.look;
  return ANIMAL_STATE.walk;
};

const getCalmRange = (profile: SpeciesProfile, state: AnimalState) => {
  if (state === ANIMAL_STATE.rest) return profile.durations.rest;
  if (state === ANIMAL_STATE.graze) return profile.durations.graze;
  if (state === ANIMAL_STATE.look) return profile.durations.look;
  return profile.durations.idle;
};

/**
 * The resting pose of this rest: rabbits sit alert, loaf, crouch or groom (grooming rarer),
 * deer and elk bed down (their head pose changes while bedded).
 */
const pickRestKind = (context: WildlifeContext, animal: number) => {
  const { motion, pool, random } = context;
  const rabbit = pool.species[animal] === SPECIES.rabbit;
  motion.restKind[animal] = rabbit ? Math.max(0, pickWeighted(RABBIT_REST_WEIGHTS, random.at("wildlife.restKind", animal))) : 0;
};

/** A rest only on a valid spot (flat, clear, away from edges); otherwise it just stands. */
const canRestHere = (context: WildlifeContext, animal: number) => {
  const { nav, pool } = context;
  const { bodyScale, heading, species, x, z } = pool;
  if (context.isCrowded?.(animal)) return false;
  return isRestSpotValid(
    nav,
    species[animal]!,
    x[animal]!,
    z[animal]!,
    heading[animal]!,
    bodyScale[animal]!
  );
};

/**
 * Next calm activity with a weighted duration. Family: the young keep close to their mother
 * (always rejoin beyond a few metres), others rejoin a herd they strayed from now and then.
 */
const enterCalm = (context: WildlifeContext, animal: number, afterMove: boolean) => {
  const { pool, random } = context;
  const profile = getSpecies(pool.species[animal]!);
  const young = isYoung(pool, animal);
  const followAt = profile.personalSpace * (young ? YOUNG_FOLLOW_DISTANCE : FOLLOW_DISTANCE);
  const strayed = getLeaderDistance(context, animal) > followAt;
  if (strayed && random.at("wildlife.rejoin", animal)() < (young ? 1 : 0.75) && startWalk(context, animal, true)) return;
  const state = pickCalmState(context, animal, profile, afterMove);
  if (state === ANIMAL_STATE.walk && startWalk(context, animal, false)) return;
  const restless = state === ANIMAL_STATE.rest && !canRestHere(context, animal);
  const calmState = state === ANIMAL_STATE.walk || restless ? ANIMAL_STATE.idle : state;
  const length = pickDuration(getCalmRange(profile, calmState), random.at("wildlife.calmLength", animal)) * pool.idleBias[animal]!;
  setState(context, animal, calmState, length);
  if (calmState === ANIMAL_STATE.rest) pickRestKind(context, animal);
};

/** Steers along the route: probes around the next waypoint, separation from herd mates. */
const steerRoute = (context: WildlifeContext, animal: number) => {
  const { nav, pool } = context;
  const species = pool.species[animal]!;
  const profile = getSpecies(species);
  const x = pool.x[animal]!;
  const z = pool.z[animal]!;
  const dx = getWaypointX(pool, animal) - x;
  const dz = getWaypointZ(pool, animal) - z;
  const length = DMath.hypot(dx, dz) || 1;
  const push = getSeparation(x, z, animal, pool, pool.active.length, profile.personalSpace * 0.8);
  const desired = DMath.atan2(dz / length + push.z * 0.5, dx / length + push.x * 0.5);
  const lookahead = Math.min(length, profile.clearance + pool.speed[animal]! * 0.7 + 0.3);
  const heading = steerHeading(
    nav,
    species,
    x,
    z,
    pool.heading[animal]!,
    desired,
    lookahead,
    pool.bodyScale[animal]!
  );
  if (!Number.isNaN(heading)) {
    pool.desiredHeading[animal] = heading;
    return true;
  }
  return planRoute(context, animal, pool.targetX[animal]!, pool.targetZ[animal]!);
};

const thinkMove = (context: WildlifeContext, animal: number, interval: number) => {
  const { pool, random } = context;
  if (!hasRoute(pool, animal)) {
    enterCalm(context, animal, true);
    return;
  }
  if (pool.blocked[animal]! > STUCK_SECONDS) {
    pool.blocked[animal] = 0;
    enterCalm(context, animal, true);
    return;
  }
  const calm = pool.state[animal] !== ANIMAL_STATE.flee;
  if (calm && random.at("wildlife.earlyStop", animal)() < EARLY_STOP_RATE * interval) {
    enterCalm(context, animal, true);
    return;
  }
  if (!steerRoute(context, animal)) enterCalm(context, animal, true);
};

const getThreatDistance = (context: WildlifeContext, animal: number) => {
  const { pool } = context;
  return DMath.hypot(
    pool.threatX[animal]! - pool.x[animal]!,
    pool.threatZ[animal]! - pool.z[animal]!
  );
};

/** Head towards the stimulus, relative to the body (clamped to what a neck can turn). */
const faceThreat = (context: WildlifeContext, animal: number) => {
  const { motion, pool } = context;
  const toThreat = DMath.atan2(
    pool.threatZ[animal]! - pool.z[animal]!,
    pool.threatX[animal]! - pool.x[animal]!
  );
  const relative = wrapAngle(toThreat - pool.heading[animal]!);
  motion.headYawTarget[animal] = Math.max(-1.1, Math.min(1.1, relative));
};

const enterRecover = (context: WildlifeContext, animal: number) => {
  const profile = getSpecies(context.pool.species[animal]!);
  setState(
    context,
    animal,
    ANIMAL_STATE.recover,
    randomInRange(context.random.at("wildlife.recover", animal), profile.durations.recover)
  );
};

/** Tells herd mates (once, second hand) after a short, individual delay. */
const alarmHerd = (context: WildlifeContext, animal: number, kind: number) => {
  const { pool, random } = context;
  if (pool.secondHand[animal]) return;
  const group = pool.group[animal]!;
  for (let other = 0; other < pool.active.length; other += 1) {
    if (other === animal || !pool.active[other] || pool.pending[other] || pool.group[other] !== group) continue;
    if (pool.state[other] === ANIMAL_STATE.flee || pool.reaction[other] === REACTION.flee) continue;
    pool.threatX[other] = pool.threatX[animal]!;
    pool.threatZ[other] = pool.threatZ[animal]!;
    pool.threatAge[other] = 0;
    pool.threatIntensity[other] = pool.threatIntensity[animal]! * HERD_INTENSITY;
    pool.alertLevel[other] = Math.max(
      pool.alertLevel[other]!,
      pool.alertLevel[animal]! * HERD_INTENSITY
    );
    pool.secondHand[other] = 1;
    pool.reaction[other] = Math.max(pool.reaction[other]!, kind);
    pool.reactionDelay[other] = randomInRange(random.at("wildlife.herdDelay", other), HERD_DELAY);
  }
};

/** Flight: picks a reachable escape and runs; frozen alert when every way out is blocked. */
const startFlee = (context: WildlifeContext, animal: number) => {
  setState(context, animal, ANIMAL_STATE.flee, FLEE_REVIEW);
  alarmHerd(context, animal, REACTION.flee);
  if (startEscape(context, animal)) {
    context.onFlee?.(animal);
    return;
  }
  setState(context, animal, ANIMAL_STATE.alert, FLEE_REVIEW);
};

const enterAlert = (context: WildlifeContext, animal: number) => {
  const { pool, random } = context;
  if (pool.state[animal] === ANIMAL_STATE.flee) return;
  const profile = getSpecies(pool.species[animal]!);
  setState(context, animal, ANIMAL_STATE.alert, randomInRange(random.at("wildlife.alert", animal), profile.durations.alert));
  faceThreat(context, animal);
  alarmHerd(context, animal, REACTION.alert);
};

/** A scheduled reaction is due (after the species' reaction delay). */
export const runReaction = (context: WildlifeContext, animal: number) => {
  const { pool } = context;
  const kind = pool.reaction[animal]!;
  pool.reaction[animal] = REACTION.none;
  if (kind === REACTION.flee) startFlee(context, animal);
  else if (kind === REACTION.alert) enterAlert(context, animal);
};

const isThreatClose = (context: WildlifeContext, animal: number) => {
  const { pool } = context;
  const profile = getSpecies(pool.species[animal]!);
  if (pool.threatAge[animal]! > 4) return false;
  return getThreatDistance(context, animal) < profile.fleeRadius || pool.alertLevel[animal]! > 0.85;
};

const thinkAlert = (context: WildlifeContext, animal: number) => {
  const { pool } = context;
  faceThreat(context, animal);
  if (isThreatClose(context, animal)) {
    startFlee(context, animal);
    return;
  }
  if (pool.stateTime[animal]! >= pool.stateLength[animal]!) enterRecover(context, animal);
};

const thinkFlee = (context: WildlifeContext, animal: number, interval: number) => {
  const { pool } = context;
  const profile = getSpecies(pool.species[animal]!);
  const safe = getThreatDistance(context, animal) > profile.safeDistance;
  if ((safe && pool.stateTime[animal]! > 1.5) || pool.threatAge[animal]! > 8) {
    enterRecover(context, animal);
    return;
  }
  const review = pool.stateTime[animal]! >= pool.stateLength[animal]!;
  if (review || !hasRoute(pool, animal)) {
    pool.stateLength[animal] = pool.stateTime[animal]! + FLEE_REVIEW;
    if (!startEscape(context, animal)) {
      setState(context, animal, ANIMAL_STATE.alert, FLEE_REVIEW);
      return;
    }
  }
  thinkMove(context, animal, interval);
};

/**
 * One AI decision (run at a distance based rate; `interval` seconds since the last one).
 * Calm states run out into the next activity, moves steer along their route, alert animals
 * watch the stimulus and flee when it comes close, fleeing ones re-plan until safe.
 */
export const think = (context: WildlifeContext, animal: number, interval: number) => {
  if (thinkHuntedAnimal(context, animal)) return;
  const { pool } = context;
  const state = pool.state[animal]!;
  if (state === ANIMAL_STATE.flee) {
    thinkFlee(context, animal, interval);
    return;
  }
  if (state === ANIMAL_STATE.alert) {
    thinkAlert(context, animal);
    return;
  }
  if (isMovingState(state)) {
    thinkMove(context, animal, interval);
    return;
  }
  if (
    state === ANIMAL_STATE.recover &&
    pool.threatAge[animal]! < 1 &&
    isThreatClose(context, animal)
  ) {
    startFlee(context, animal);
    return;
  }
  if (pool.stateTime[animal]! >= pool.stateLength[animal]!) enterCalm(context, animal, false);
};

/**
 * Threat stimulus (hunter, unit, loud event): remembered, the alert level rises with intensity
 * and nearness; a close or strong threat schedules a flight, a weaker one an alert, each after
 * the species' reaction delay. Herd mates are told by the animal when it reacts.
 */
export const perceiveThreat = (
  context: WildlifeContext,
  animal: number,
  x: number,
  z: number,
  intensity: number
) => {
  const { pool, random } = context;
  const profile = getSpecies(pool.species[animal]!);
  const shyness = pool.shyness[animal]!;
  const radius = profile.alertRadius * (0.6 + intensity * 0.8) * shyness;
  const distance = DMath.hypot(x - pool.x[animal]!, z - pool.z[animal]!);
  if (distance > radius) return;
  pool.threatX[animal] = x;
  pool.threatZ[animal] = z;
  pool.threatAge[animal] = 0;
  pool.threatIntensity[animal] = intensity;
  pool.lastThreatTime[animal] = context.time;
  pool.secondHand[animal] = 0;
  const level = Math.min(1, intensity * (1.25 - distance / radius) + 0.2);
  pool.alertLevel[animal] = Math.max(pool.alertLevel[animal]!, level);
  if (pool.state[animal] === ANIMAL_STATE.flee) return;
  const urgent =
    distance < profile.fleeRadius * (0.6 + intensity * 0.6) * shyness ||
    pool.alertLevel[animal]! > 0.85;
  const kind = urgent ? REACTION.flee : REACTION.alert;
  if (pool.reaction[animal]! >= kind) return;
  pool.reaction[animal] = kind;
  pool.reactionDelay[animal] = randomInRange(random.at("wildlife.reaction", animal), profile.reaction);
};
