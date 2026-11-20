import { approach } from "../../birds/bird-flight";
import { CLIP } from "../model/critter-model";
import { type CritterContext, distanceTo, moveForward, pickDuration, pickTargetNear, setTimedMode, steerTowards } from "./critter-context";
import type { CritterPool } from "./critter-pool";
import { canWalkGround } from "./critter-roam";

/**
 * Squirrels among the trees: they hop about the forest floor near a trunk, nibble, sit up and
 * look around, then dash to a tree and run up the trunk into the crown (out of sight a while)
 * and come down head first. A worker or a felling close by sends them straight up a tree.
 */
const CLIMB_MODE = {
  forage: 0,
  feed: 1,
  look: 2,
  sit: 3,
  dash: 4,
  climbUp: 5,
  crown: 6,
  climbDown: 7
} as const;

const HOP_SPEED = 0.55;
const DASH_SPEED = 1.1;
const CLIMB_SPEED = 0.55;
/** World units per hop. */
const HOP_LENGTH = 0.16;
const HOP_HEIGHT = 0.035;
const FORAGE_RANGE = 2.2;
const TREE_SEARCH = 4;
const FLEE_RADIUS = 3;
/** Distance from the trunk centre while clinging (bark). */
const TRUNK_OFFSET = 0.09;
const TURN_RATE = 5;
/** Height tolerance of the top and the foot of the climb (the pool stores 32 bit floats). */
const ARRIVED = 0.002;

/** The tree it climbs (kept in `originX`), the nearest standing one if none yet. */
const findTree = (pool: CritterPool, index: number, context: CritterContext) => {
  const trees = context.trees;
  if (!trees) return -1;
  return trees.findNearest(pool.x[index]!, pool.z[index]!, TREE_SEARCH);
};

const startDash = (pool: CritterPool, index: number, context: CritterContext) => {
  const tree = findTree(pool, index, context);
  if (tree < 0 || !context.trees) return setTimedMode(pool, index, CLIMB_MODE.look, 2);
  pool.originX[index] = tree;
  const trees = context.trees;
  const away = Math.atan2(pool.z[index]! - trees.z(tree), pool.x[index]! - trees.x(tree));
  pool.targetX[index] = trees.x(tree) + Math.cos(away) * TRUNK_OFFSET;
  pool.targetZ[index] = trees.z(tree) + Math.sin(away) * TRUNK_OFFSET;
  setTimedMode(pool, index, CLIMB_MODE.dash, 12);
};

const startForage = (pool: CritterPool, index: number, context: CritterContext) => {
  const site = context.sites[pool.site[index]!]!;
  const target = pickTargetNear(
    context,
    site,
    FORAGE_RANGE,
    canWalkGround(context, pool.species[index]!)
  );
  if (!target) return setTimedMode(pool, index, CLIMB_MODE.sit, 2);
  pool.targetX[index] = target.x;
  pool.targetZ[index] = target.z;
  setTimedMode(pool, index, CLIMB_MODE.forage, 10);
};

const chooseActivity = (pool: CritterPool, index: number, context: CritterContext) => {
  const { random } = context;
  const roll = random();
  if (roll < 0.35) return startForage(pool, index, context);
  if (roll < 0.6) return setTimedMode(pool, index, CLIMB_MODE.feed, pickDuration(random, 1.5, 5));
  if (roll < 0.75) {
    pool.lift[index] = random() < 0.5 ? 0 : 1;
    return setTimedMode(pool, index, CLIMB_MODE.look, pickDuration(random, 1, 2.5));
  }
  if (roll < 0.85) return setTimedMode(pool, index, CLIMB_MODE.sit, pickDuration(random, 1.5, 4));
  startDash(pool, index, context);
};

/** Hops along: a little arc per hop, the phase drives the two hop frames. */
const hopTowards = (pool: CritterPool, index: number, context: CritterContext, speed: number) => {
  steerTowards(pool, index, pool.targetX[index]!, pool.targetZ[index]!, TURN_RATE, context.step);
  pool.speed[index] = speed;
  const moved = moveForward(
    pool,
    index,
    context.step,
    canWalkGround(context, pool.species[index]!)
  );
  if (moved) pool.pose[index] = pool.pose[index]! + (speed * context.step) / HOP_LENGTH;
  const left = distanceTo(pool, index, pool.targetX[index]!, pool.targetZ[index]!);
  if (!moved || left < 0.06) pool.timer[index] = 0;
  return left;
};

const getGround = (pool: CritterPool, index: number, context: CritterContext) =>
  context.terrain.ground(pool.x[index]!, pool.z[index]!);

const updateClimb = (pool: CritterPool, index: number, context: CritterContext, up: boolean) => {
  const tree = pool.originX[index]!;
  const top = context.trees ? context.trees.getCrownHeight(tree) : getGround(pool, index, context);
  const ground = getGround(pool, index, context);
  const rate = CLIMB_SPEED * context.step * (up ? 1 : -1);
  pool.y[index] = Math.min(top, Math.max(ground, pool.y[index]! + rate));
  pool.pose[index] = up ? 1 : 0;
  if (up && pool.y[index]! >= top - ARRIVED) {
    pool.hidden[index] = 1;
    setTimedMode(pool, index, CLIMB_MODE.crown, pickDuration(context.random, 6, 25));
  }
  if (!up && pool.y[index]! <= ground + ARRIVED) setTimedMode(pool, index, CLIMB_MODE.look, 1.5);
};

/** Up the trunk it faces the bark, down it faces away (head first, the belly on the bark). */
const turnAround = (pool: CritterPool, index: number) => {
  pool.heading[index] = pool.heading[index]! + Math.PI;
};

/** In the crown: unseen; comes down head first (facing the trunk from above). */
const updateCrown = (pool: CritterPool, index: number, _context: CritterContext) => {
  if (pool.timer[index]! > 0) return;
  pool.hidden[index] = 0;
  turnAround(pool, index);
  setTimedMode(pool, index, CLIMB_MODE.climbDown, 20);
  pool.clip[index] = CLIP.air;
};

const checkThreat = (pool: CritterPool, index: number, context: CritterContext) => {
  const mode = pool.mode[index]!;
  if (mode >= CLIMB_MODE.dash && mode !== CLIMB_MODE.climbDown) return;
  if (!context.findThreat(pool.x[index]!, pool.z[index]!, FLEE_RADIUS)) return;
  if (mode === CLIMB_MODE.climbDown) {
    turnAround(pool, index);
    return setTimedMode(pool, index, CLIMB_MODE.climbUp, 20);
  }
  startDash(pool, index, context);
};

const CLIPS = [CLIP.move, CLIP.feed, CLIP.look, CLIP.rest, CLIP.fast, CLIP.air, CLIP.air, CLIP.air];

const easePose = (pool: CritterPool, index: number, context: CritterContext, goal: number) => {
  const target = pool.timer[index]! < 0.5 ? 0 : goal;
  pool.pose[index] = approach(pool.pose[index]!, target, context.step * 3);
};

const updateGroundMode = (pool: CritterPool, index: number, context: CritterContext) => {
  const mode = pool.mode[index]!;
  if (mode === CLIMB_MODE.forage) hopTowards(pool, index, context, HOP_SPEED);
  if (mode === CLIMB_MODE.feed || mode === CLIMB_MODE.sit) easePose(pool, index, context, 1);
  if (mode === CLIMB_MODE.look) easePose(pool, index, context, pool.lift[index]!);
  const hop = mode === CLIMB_MODE.forage ? Math.abs(Math.sin(pool.pose[index]! * Math.PI)) : 0;
  pool.y[index] = getGround(pool, index, context) + hop * HOP_HEIGHT;
};

const updateMode = (pool: CritterPool, index: number, context: CritterContext) => {
  const mode = pool.mode[index]!;
  if (mode === CLIMB_MODE.crown) return updateCrown(pool, index, context);
  if (mode === CLIMB_MODE.climbUp) return updateClimb(pool, index, context, true);
  if (mode === CLIMB_MODE.climbDown) return updateClimb(pool, index, context, false);
  if (mode !== CLIMB_MODE.dash) return updateGroundMode(pool, index, context);
  const left = hopTowards(pool, index, context, DASH_SPEED);
  pool.y[index] = getGround(pool, index, context);
  if (left < 0.06) setTimedMode(pool, index, CLIMB_MODE.climbUp, 20);
};

/** One step of a squirrel. */
export const updateClimber = (pool: CritterPool, index: number, context: CritterContext) => {
  checkThreat(pool, index, context);
  pool.timer[index] = pool.timer[index]! - context.step;
  const busy = pool.mode[index]! >= CLIMB_MODE.dash;
  if (pool.timer[index]! <= 0 && !busy) chooseActivity(pool, index, context);
  const clip = CLIPS[pool.mode[index]!]!;
  if (clip !== pool.clip[index]) pool.pose[index] = clip === CLIP.look ? 0.5 : 0;
  pool.clip[index] = clip;
  updateMode(pool, index, context);
};

export const spawnClimber = (pool: CritterPool, index: number, context: CritterContext) => {
  setTimedMode(pool, index, CLIMB_MODE.feed, pickDuration(context.random, 0.5, 4));
  pool.clip[index] = CLIP.feed;
  pool.y[index] = getGround(pool, index, context);
  pool.lift[index] = 0;
};
