import { approach } from "../../birds/bird-flight";
import { isGroundWalkable, isSegmentWalkable, isStandFree } from "../../wildlife/nav/nav-query";
import { wrapAngle } from "../../wildlife/nav/nav-steering";
import { CLIP } from "../model/critter-model";
import { type CritterContext, distanceTo, getAwayHeading, moveAround, pickDuration, pickTargetNear, setTimedMode, steerTowards } from "./critter-context";
import type { CritterPool } from "./critter-pool";
import { CURL_SECONDS, GAIT, type Gait, getRoamStyle, type RoamStyle } from "./critter-roam-styles";
import { isRockFree, isRockLegFree } from "./critter-rock";

/**
 * Four legged critters on the ground (fox, boar sounder, wolf pack, bear, chamois, hedgehog):
 * they stand, look around, sniff or root, wander to a spot near their home along a free straight
 * line (the wildlife navigation: no trunks, rocks, water or cliffs), lie down to rest, and trot
 * away from the worker or a felling. Followers (piglets, the pack) keep near their leader.
 */
export const ROAM_MODE = { stand: 0, walk: 1, feed: 2, look: 3, rest: 4, flee: 5 } as const;

const TURN_RATE = 2.4;
/** Speed change per second (share of the step): flight bursts away. */
const WALK_ACCELERATION = 2;
const RUN_ACCELERATION = 3.5;
/** A follower this far behind its spot trots to catch up. */
const CATCH_UP_DISTANCE = 1.5;
const RANGE = 5;
/** Resting is likelier in its sleeping time of day. */
const SLEEPY = 0.18;

const getStyle = (pool: CritterPool, index: number) => getRoamStyle(pool.species[index]!);

/** Walkable ground of a small critter: its navigation mask, else dry ground (no colliders). */
export const canWalkGround = (context: CritterContext, species: number) => {
  const { nav, terrain } = context;
  const navSpecies = getRoamStyle(species).nav;
  if (nav) return (x: number, z: number) => isGroundWalkable(nav, navSpecies, x, z);
  return (x: number, z: number) => terrain.depth(x, z) < 0.01;
};

/**
 * Where a roaming critter may stand: its navigation mask clear of trunks, rocks and blocking
 * shrubs (the wildlife colliders), else dry ground.
 */
export const isRoamFree = (context: CritterContext, species: number, x: number, z: number) => {
  const { nav, terrain } = context;
  const style = getRoamStyle(species);
  if (style.climber) return isRockFree(context, x, z);
  if (!nav) return terrain.depth(x, z) < 0.01;
  return isStandFree(nav, style.nav, x, z);
};

const canRoam = (context: CritterContext, species: number) => (x: number, z: number) =>
  isRoamFree(context, species, x, z);

/** Crowns or a ridge in front hide a critter from the camera: it stops where it is seen. */
const isGlade = ({ terrain }: CritterContext, x: number, z: number) => !terrain.hidden(x, z);

/** Where a roaming critter is placed: walkable ground in a glade (seen from the camera). */
export const canRoamInGlade = (context: CritterContext, species: number) => {
  const roams = canRoam(context, species);
  return (x: number, z: number) => roams(x, z) && isGlade(context, x, z);
};

/** A straight leg free of trunks, rocks, water and cliff edges (ending in a glade if asked). */
const isLegFree =
  (context: CritterContext, style: RoamStyle, from: { x: number; z: number }, glade: boolean) =>
  (x: number, z: number) => {
    if (glade && !isGlade(context, x, z)) return false;
    if (style.climber) return isRockLegFree(context, from, x, z);
    if (!context.nav) return context.terrain.depth(x, z) < 0.01;
    return isSegmentWalkable(context.nav, style.nav, from.x, from.z, x, z);
  };

const isSleepyTime = (style: RoamStyle, daylight: number) =>
  style.restsByDay ? daylight > 0.8 : daylight < 0.3;

/** Legs are short (straight ways through a wood are), always within the home range. */
const LEG = 2.6;

const startWalk = (pool: CritterPool, index: number, context: CritterContext, style: RoamStyle) => {
  const site = context.sites[pool.site[index]!]!;
  const from = { x: pool.x[index]!, z: pool.z[index]! };
  const legTo = (glade: boolean) => {
    const free = isLegFree(context, style, from, glade);
    return (x: number, z: number) => Math.hypot(x - site.x, z - site.z) <= RANGE && free(x, z);
  };
  const seen = pickTargetNear(context, from, LEG, legTo(true));
  /** No seen spot in reach: a forest critter walks on under the trees, a climber waits. */
  const target = seen ?? (style.climber ? null : pickTargetNear(context, from, LEG, legTo(false)));
  if (!target) return setTimedMode(pool, index, ROAM_MODE.stand, 2);
  pool.targetX[index] = target.x;
  pool.targetZ[index] = target.z;
  setTimedMode(pool, index, ROAM_MODE.walk, 40);
};

const chooseActivity = (pool: CritterPool, index: number, context: CritterContext) => {
  const style = getStyle(pool, index);
  const { random } = context;
  const [walk, feed, look, rest] = style.odds;
  const restShare = isSleepyTime(style, context.daylight) ? SLEEPY : rest;
  const roll = random();
  if (roll < restShare) return setTimedMode(pool, index, ROAM_MODE.rest, pickDuration(random, 8, 24));
  const calm = (roll - restShare) / (1 - restShare);
  if (calm < walk) return startWalk(pool, index, context, style);
  if (calm < walk + feed) {
    return setTimedMode(pool, index, ROAM_MODE.feed, pickDuration(random, ...style.feed));
  }
  if (calm < walk + feed + look) {
    pool.originX[index] = random() < 0.5 ? 0 : 1;
    return setTimedMode(pool, index, ROAM_MODE.look, pickDuration(random, 1.5, 4));
  }
  setTimedMode(pool, index, ROAM_MODE.stand, pickDuration(random, 1, 5));
};

const walkTo = (pool: CritterPool, index: number, context: CritterContext, gait: Gait) => {
  const style = getStyle(pool, index);
  const heading = pool.heading[index]!;
  const targetHeading = Math.atan2(
    pool.targetZ[index]! - pool.z[index]!,
    pool.targetX[index]! - pool.x[index]!
  );
  const error = Math.abs(wrapAngle(targetHeading - heading));
  const turnRate = (style.turnRate ?? TURN_RATE) * (gait === GAIT.run ? 0.7 : 1);
  steerTowards(pool, index, pool.targetX[index]!, pool.targetZ[index]!, turnRate, context.step);
  const rate = gait === GAIT.run ? RUN_ACCELERATION : WALK_ACCELERATION;
  const braking = Math.max(0.15, Math.cos(Math.min(Math.PI / 2, error)));
  pool.speed[index] = approach(
    pool.speed[index]!,
    style.speed[gait] * braking,
    context.step * rate
  );
  const remainingTurn = Math.max(
    0,
    turnRate * context.step - Math.abs(wrapAngle(pool.heading[index]! - heading))
  );
  const moved = moveAround(
    pool,
    index,
    context.step,
    canRoam(context, pool.species[index]!),
    remainingTurn
  );
  if (!moved && Math.abs(wrapAngle(pool.heading[index]! - heading)) < 1e-4) pool.timer[index] = 0;
  const cycle = style.cycle[gait];
  if (moved) pool.pose[index] = pool.pose[index]! + (pool.speed[index]! * context.step) / cycle;
  return distanceTo(pool, index, pool.targetX[index]!, pool.targetZ[index]!);
};

/** Followers keep near the leader: the pack in a loose file, piglets around the sow. */
const updateFollower = (
  pool: CritterPool,
  index: number,
  leader: number,
  context: CritterContext
) => {
  const style = getStyle(pool, index);
  const angle = pool.seed[index]! * Math.PI * 2;
  const gap = style.spacing * (1 + (pool.member[index]! % 3) * 0.5);
  pool.targetX[index] = pool.x[leader]! - Math.cos(pool.heading[leader]! + angle * 0.4) * gap;
  pool.targetZ[index] = pool.z[leader]! - Math.sin(pool.heading[leader]! + angle * 0.4) * gap;
  const leaderMode = pool.mode[leader]!;
  const far = distanceTo(pool, index, pool.targetX[index]!, pool.targetZ[index]!) > 0.3;
  if (leaderMode === ROAM_MODE.flee || leaderMode === ROAM_MODE.rest) {
    pool.mode[index] = leaderMode;
    pool.timer[index] = pool.timer[leader]!;
  } else if (far) pool.mode[index] = ROAM_MODE.walk;
  else if (pool.mode[index] === ROAM_MODE.walk || pool.timer[index]! <= 0) {
    chooseFollowerPause(pool, index, context);
  }
};

const chooseFollowerPause = (pool: CritterPool, index: number, context: CritterContext) => {
  const feed = context.random() < 0.5;
  const style = getStyle(pool, index);
  if (feed) setTimedMode(pool, index, ROAM_MODE.feed, pickDuration(context.random, ...style.feed));
  else setTimedMode(pool, index, ROAM_MODE.stand, pickDuration(context.random, 1, 4));
};

const checkThreat = (pool: CritterPool, index: number, context: CritterContext) => {
  if (pool.mode[index] === ROAM_MODE.flee && pool.timer[index]! > 0) return;
  const style = getStyle(pool, index);
  const threat = context.findThreat(pool.x[index]!, pool.z[index]!, style.fleeRadius);
  if (!threat) return;
  if (style.curls) {
    if (pool.mode[index] !== ROAM_MODE.rest) setTimedMode(pool, index, ROAM_MODE.rest, CURL_SECONDS);
    pool.timer[index] = Math.max(pool.timer[index]!, CURL_SECONDS * 0.5);
    return;
  }
  const away = getAwayHeading(pool, index, threat.x, threat.z);
  pool.targetX[index] = pool.x[index]! + Math.cos(away) * RANGE;
  pool.targetZ[index] = pool.z[index]! + Math.sin(away) * RANGE;
  setTimedMode(pool, index, ROAM_MODE.flee, 4);
};

const CLIPS = [CLIP.idle, CLIP.move, CLIP.feed, CLIP.look, CLIP.rest, CLIP.run];

const updatePose = (pool: CritterPool, index: number, context: CritterContext) => {
  const mode = pool.mode[index]!;
  if (mode === ROAM_MODE.feed || mode === ROAM_MODE.rest) {
    const goal = pool.timer[index]! < 0.8 ? 0 : 1;
    const rate = mode === ROAM_MODE.rest ? 0.8 : 2;
    pool.pose[index] = approach(pool.pose[index]!, goal, context.step * rate);
  }
  if (mode === ROAM_MODE.look) {
    const goal = pool.timer[index]! < 0.6 ? 0.5 : pool.originX[index]!;
    pool.pose[index] = approach(pool.pose[index]!, goal, context.step * 1.5);
  }
};

/** Flight gallops (where the species can), a follower far behind trots, the rest walk. */
const pickGait = (pool: CritterPool, index: number, mode: number, behind: number): Gait => {
  if (mode === ROAM_MODE.flee) return GAIT.run;
  const catchingUp = pool.leader[index]! >= 0 && behind > CATCH_UP_DISTANCE;
  return catchingUp ? GAIT.trot : GAIT.walk;
};

const updateMode = (pool: CritterPool, index: number, context: CritterContext) => {
  const mode = pool.mode[index]!;
  if (mode === ROAM_MODE.walk || mode === ROAM_MODE.flee) {
    const behind = distanceTo(pool, index, pool.targetX[index]!, pool.targetZ[index]!);
    const left = walkTo(pool, index, context, pickGait(pool, index, mode, behind));
    if (left < 0.15 && pool.leader[index]! < 0) pool.timer[index] = 0;
    return;
  }
  pool.speed[index] = 0;
  updatePose(pool, index, context);
};

const setClip = (pool: CritterPool, index: number) => {
  const clip = CLIPS[pool.mode[index]!]!;
  if (clip === pool.clip[index]) return;
  pool.pose[index] = clip === CLIP.look ? 0.5 : 0;
  pool.clip[index] = clip;
};

/** One step of a roaming forest critter. */
export const updateRoamer = (pool: CritterPool, index: number, context: CritterContext) => {
  checkThreat(pool, index, context);
  pool.timer[index] = pool.timer[index]! - context.step;
  const leader = pool.leader[index]!;
  const leads = leader >= 0 && pool.active[leader] === 1 && pool.carcass[leader] === 0;
  if (leads) updateFollower(pool, index, leader, context);
  else if (pool.timer[index]! <= 0) chooseActivity(pool, index, context);
  setClip(pool, index);
  updateMode(pool, index, context);
  pool.y[index] = context.terrain.ground(pool.x[index]!, pool.z[index]!);
};

export const spawnRoamer = (pool: CritterPool, index: number, context: CritterContext) => {
  setTimedMode(pool, index, ROAM_MODE.stand, pickDuration(context.random, 0.5, 5));
  pool.clip[index] = CLIP.idle;
  pool.lift[index] = 0;
};
