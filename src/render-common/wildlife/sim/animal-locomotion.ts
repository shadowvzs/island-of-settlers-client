import { TICK_SECONDS } from "../../../../../island-of-settlers-shared/src/time/constants";
import { DMath } from "../../../shared/math/deterministic-math";
import { sampleSmooth } from "../../../shared/world/grid-geometry";
import { isCircleBlocked } from "../nav/nav-colliders";
import { isBodyFree, isGroundWalkable } from "../nav/nav-query";
import { turnSmoothly, turnTowards, wrapAngle } from "../nav/nav-steering";
import { sampleNavHeight } from "../nav/nav-terrain";
import { ANIMAL_STATE, getSpecies, type SpeciesProfile } from "../wildlife-species";
import { getAgeSpeed } from "../wildlife-stages";
import { isRisen } from "./animal-animation";
import { isMovingState, runReaction } from "./animal-brain";
import { REACTION } from "./animal-pool";
import { easeToward, getWaypointX, getWaypointZ, hasRoute, type WildlifeContext } from "./wildlife-context";

/** Headings tried when the straight move is blocked: slide along the obstacle. */
const SLIDE_ANGLES = [0.6, -0.6, 1.1, -1.1] as const;
const ALERT_DECAY = 0.07;
/** Largest body tilt on slopes (radians): animals do not rotate with every terrain bump. */
const MAX_PITCH = 0.32;
const MAX_ROLL = 0.12;
const TILT_RATE = 4;
const WAYPOINT_ARRIVAL_RADIUS = 0.15;

const getTargetSpeed = (profile: SpeciesProfile, state: number) => {
  if (state === ANIMAL_STATE.flee) return profile.run.speed;
  if (state === ANIMAL_STATE.trot) return profile.trot.speed;
  if (state === ANIMAL_STATE.walk) return profile.walk.speed;
  return 0;
};

/** Acceleration (units / s^2): bursts away quickly, settles down gently. */
const getAcceleration = (profile: SpeciesProfile, speeding: boolean) =>
  speeding ? profile.run.speed * 1.6 : profile.walk.speed * 3;

/** Advances along the route: waypoints passed within the arrival radius are dropped. */
const followWaypoints = (context: WildlifeContext, animal: number) => {
  const { pool } = context;
  if (!hasRoute(pool, animal)) return;
  const dx = getWaypointX(pool, animal) - pool.x[animal]!;
  const dz = getWaypointZ(pool, animal) - pool.z[animal]!;
  if (DMath.hypot(dx, dz) > WAYPOINT_ARRIVAL_RADIUS + pool.speed[animal]! * 0.12) return;
  pool.pathIndex[animal]! += 1;
  pool.aiTimer[animal] = 0;
  if (!hasRoute(pool, animal)) return;
  pool.desiredHeading[animal] = DMath.atan2(
    getWaypointZ(pool, animal) - pool.z[animal]!,
    getWaypointX(pool, animal) - pool.x[animal]!
  );
};

/** The body capsule overlaps something where it stands (only after a squeezed respawn). */
const isStuckInside = (context: WildlifeContext, animal: number) => {
  const { nav, pool } = context;
  return !isBodyFree(
    nav,
    pool.species[animal]!,
    pool.x[animal]!,
    pool.z[animal]!,
    pool.heading[animal]!,
    pool.bodyScale[animal]!
  );
};

/** A stuck body may only step to points whose centre circle is clear (it works its way out). */
const canEscapeTo = (context: WildlifeContext, animal: number, x: number, z: number) => {
  const { nav, pool } = context;
  const species = pool.species[animal]!;
  const { bit, clearance } = nav.species[species]!;
  return (
    isGroundWalkable(nav, species, x, z) && !isCircleBlocked(nav.colliders, bit, x, z, clearance)
  );
};

/**
 * One validated move (checked at the float32 position it is stored as): the whole body (rump to nose, facing its heading) stays on walkable
 * ground and clear of trunks, crowns, rocks and shrubs, and no sudden rise is climbed.
 */
const canMoveTo = (context: WildlifeContext, animal: number, x: number, z: number) => {
  const { nav, pool } = context;
  const species = pool.species[animal]!;
  const free = isBodyFree(nav, species, x, z, pool.heading[animal]!, pool.bodyScale[animal]!);
  if (!free && !(isStuckInside(context, animal) && canEscapeTo(context, animal, x, z)))
    return false;
  const step = DMath.hypot(x - pool.x[animal]!, z - pool.z[animal]!);
  const rise = Math.abs(
    sampleNavHeight(nav.terrain, x, z) -
      sampleNavHeight(nav.terrain, pool.x[animal]!, pool.z[animal]!)
  );
  return rise <= getSpecies(species).maxSlope * 1.35 * step + 0.005;
};

const moveBody = (context: WildlifeContext, animal: number, dt: number, remainingTurn: number) => {
  const { pool } = context;
  const distance = pool.speed[animal]! * dt;
  const x = pool.x[animal]!;
  const z = pool.z[animal]!;
  pool.velocityX[animal] = 0;
  pool.velocityZ[animal] = 0;
  if (distance <= 0) return;
  for (let attempt = -1; attempt < SLIDE_ANGLES.length; attempt += 1) {
    const turn = attempt < 0 ? 0 : SLIDE_ANGLES[attempt]!;
    const reach = attempt < 0 ? distance : distance * 0.5;
    const oldHeading = pool.heading[animal]!;
    const heading = turnTowards(oldHeading, oldHeading + turn, remainingTurn);
    if (
      turn !== 0 &&
      !isStuckInside(context, animal) &&
      !isBodyFree(context.nav, pool.species[animal]!, x, z, heading, pool.bodyScale[animal]!)
    )
      continue;
    pool.heading[animal] = heading;
    const nextX = Math.fround(x + DMath.cos(heading) * reach);
    const nextZ = Math.fround(z + DMath.sin(heading) * reach);
    if (!canMoveTo(context, animal, nextX, nextZ)) {
      pool.heading[animal] = oldHeading;
      continue;
    }
    pool.x[animal] = nextX;
    pool.z[animal] = nextZ;
    pool.velocityX[animal] = (nextX - x) / dt;
    pool.velocityZ[animal] = (nextZ - z) / dt;
    pool.blocked[animal] = 0;
    return;
  }
  pool.speed[animal] = 0;
  pool.blocked[animal]! += dt;
  pool.aiTimer[animal] = 0;
};

/**
 * Turning swings rump and nose around the centre: a turn that would push the body into a
 * trunk, crown or rock is refused (the steering then picks another way).
 */
const turnBody = (context: WildlifeContext, animal: number, turned: number) => {
  const heading = Math.fround(turned);
  const { nav, pool } = context;
  const species = pool.species[animal]!;
  const x = pool.x[animal]!;
  const z = pool.z[animal]!;
  if (
    isBodyFree(nav, species, x, z, heading, pool.bodyScale[animal]!) ||
    isStuckInside(context, animal)
  ) {
    pool.heading[animal] = heading;
    return;
  }
  pool.blocked[animal]! += TICK_SECONDS;
};

/** Turn rate drops at speed: a running animal sweeps wide arcs instead of pivoting. */
const steerBody = (
  context: WildlifeContext,
  animal: number,
  profile: SpeciesProfile,
  dt: number
) => {
  const { pool } = context;
  const state = pool.state[animal]!;
  // A bedded animal moves only once it is (almost) up on its legs.
  const risen = isRisen(context.motion, animal);
  const moving = isMovingState(state) && hasRoute(pool, animal) && risen;
  const speed = pool.speed[animal]!;
  const turnRate = profile.turnRate * (speed > profile.trot.speed ? 0.7 : 1);
  const headingBefore = pool.heading[animal]!;
  if (moving) {
    turnBody(
      context,
      animal,
      turnSmoothly(pool.heading[animal]!, pool.desiredHeading[animal]!, turnRate, dt)
    );
  }
  const error = Math.abs(DMath.sin((pool.desiredHeading[animal]! - pool.heading[animal]!) / 2)) * 2;
  const ageSpeed = getAgeSpeed(pool.age[animal]!);
  const target = moving ? getTargetSpeed(profile, state) * pool.speedFactor[animal]! * ageSpeed : 0;
  let slowed = target * Math.max(0.2, 1 - error * 0.6);
  if (pool.huntState[animal] && hasRoute(pool, animal)) {
    const remaining = DMath.hypot(getWaypointX(pool, animal) - pool.x[animal]!,
      getWaypointZ(pool, animal) - pool.z[animal]!);
    // Brake for the current waypoint. A curved route can pass near its final target before
    // its remaining bends; braking for that endpoint would stop the escape permanently.
    const stoppingDistance = Math.max(0, remaining - WAYPOINT_ARRIVAL_RADIUS / 2);
    slowed = Math.min(slowed, Math.sqrt(2 * profile.walk.speed * 3 * stoppingDistance));
  }
  const rate = getAcceleration(profile, slowed > speed) / Math.max(0.1, Math.abs(slowed - speed));
  pool.speed[animal] = easeToward(speed, slowed, rate, dt);
  return Math.max(0, turnRate * dt - Math.abs(wrapAngle(pool.heading[animal]! - headingBefore)));
};

/** Scratch slope of the body (radians), no allocation. */
const tilt = { pitch: 0, roll: 0 };

/** Ground height under the body (into `pool.y`) and its slope from front, back and sides. */
const sampleGround = (context: WildlifeContext, animal: number, profile: SpeciesProfile) => {
  const { pool, world } = context;
  const half = profile.length * 0.5 * pool.bodyScale[animal]!;
  const width = half * 0.45;
  const cos = DMath.cos(pool.heading[animal]!);
  const sin = DMath.sin(pool.heading[animal]!);
  const x = pool.x[animal]!;
  const z = pool.z[animal]!;
  const front = sampleSmooth(world, world.heights, x + cos * half, z + sin * half);
  const back = sampleSmooth(world, world.heights, x - cos * half, z - sin * half);
  const left = sampleSmooth(world, world.heights, x - sin * width, z + cos * width);
  const right = sampleSmooth(world, world.heights, x + sin * width, z - cos * width);
  pool.y[animal] = (front + back) / 2;
  tilt.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, DMath.atan2(front - back, half * 2)));
  tilt.roll = Math.max(-MAX_ROLL, Math.min(MAX_ROLL, DMath.atan2(left - right, width * 2)));
};

/** Ground height under the body and the smoothed pitch / roll from front, back and sides. */
const settleOnGround = (
  context: WildlifeContext,
  animal: number,
  profile: SpeciesProfile,
  dt: number
) => {
  const { motion } = context;
  sampleGround(context, animal, profile);
  motion.pitch[animal] = easeToward(motion.pitch[animal]!, tilt.pitch, TILT_RATE, dt);
  motion.roll[animal] = easeToward(motion.roll[animal]!, tilt.roll, TILT_RATE, dt);
};

/** Puts the body straight onto the ground where it stands: height, pitch and roll at once. */
export const placeOnGround = (context: WildlifeContext, animal: number) => {
  sampleGround(context, animal, getSpecies(context.pool.species[animal]!));
  context.motion.pitch[animal] = tilt.pitch;
  context.motion.roll[animal] = tilt.roll;
};

/** Pending reaction timers, threat memory and calming down. */
const updateAwareness = (context: WildlifeContext, animal: number, dt: number) => {
  const { pool } = context;
  pool.stateTime[animal]! += dt;
  pool.threatAge[animal]! += dt;
  if (pool.threatAge[animal]! > 2) {
    pool.alertLevel[animal] = Math.max(0, pool.alertLevel[animal]! - ALERT_DECAY * dt);
  }
  if (pool.huntState[animal]) { pool.reaction[animal] = REACTION.none; return; }
  if (pool.reaction[animal] === REACTION.none) return;
  pool.reactionDelay[animal]! -= dt;
  if (pool.reactionDelay[animal]! <= 0) runReaction(context, animal);
};

/**
 * One fixed step of one animal: awareness, route progress, heading inertia and speed, the
 * validated move (slides along obstacles, stops when boxed in), ground contact and tilt.
 */
export const stepAnimal = (context: WildlifeContext, animal: number, dt: number) => {
  const profile = getSpecies(context.pool.species[animal]!);
  updateAwareness(context, animal, dt);
  followWaypoints(context, animal);
  const remainingTurn = steerBody(context, animal, profile, dt);
  moveBody(context, animal, dt, remainingTurn);
  settleOnGround(context, animal, profile, dt);
};
