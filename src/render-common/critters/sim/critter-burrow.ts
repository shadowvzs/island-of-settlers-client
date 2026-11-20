import { approach } from "../../birds/bird-flight";
import { CRITTER } from "../critter-species";
import { CLIP } from "../model/critter-model";
import { type CritterContext, distanceTo, moveForward, pickDuration, pickTargetNear, setMode, steerTowards } from "./critter-context";
import type { CritterPool } from "./critter-pool";
import { canWalkGround } from "./critter-roam";

/**
 * Marmots at their burrows: hidden below for a while, they pop up out of the hole, sit up as
 * sentinels looking around, scamper a few steps to graze near the hole, lie basking on the
 * mound, run back and slip down again. Anyone close (a worker, a felling) sends them diving
 * for the hole, and they stay down a little longer. The burrow mound (the site's leader) stays.
 */
const BURROW_MODE = {
  down: 0,
  emerge: 1,
  sentinel: 2,
  forage: 3,
  graze: 4,
  bask: 5,
  home: 6,
  dive: 7,
  mound: 8
} as const;

const DOWN_SECONDS: readonly [number, number] = [3, 14];
const SCARED_SECONDS: readonly [number, number] = [8, 18];
const EMERGE_SECONDS = 0.9;
const DIVE_SECONDS = 0.45;
const FORAGE_RANGE = 1.1;
const THREAT_RADIUS = 4.5;
const WALK_SPEED = 0.28;
const RUN_SPEED = 0.85;
const TURN_RATE = 5;
const CYCLE = 0.16;
const AT_HOME = 0.08;

/** Where a marmot digs and scampers: its walkable ground, never under the rendered rock. */
export const canBurrowerWalk = (context: CritterContext, species: number) => {
  const walks = canWalkGround(context, species);
  return (x: number, z: number) => walks(x, z) && !context.terrain.underRock(x, z);
};

/** The burrow mound the marmot lives in (its leader), else its own spot. */
const getHome = (pool: CritterPool, index: number) => {
  const leader = pool.leader[index]!;
  if (leader >= 0 && pool.active[leader] === 1) return leader;
  return index;
};

const goDown = (pool: CritterPool, index: number, context: CritterContext, scared: boolean) => {
  const range = scared ? SCARED_SECONDS : DOWN_SECONDS;
  pool.hidden[index] = 1;
  setMode(pool, index, BURROW_MODE.down, pickDuration(context.random, ...range));
};

const startForage = (pool: CritterPool, index: number, context: CritterContext) => {
  const home = getHome(pool, index);
  const centre = { x: pool.x[home]!, z: pool.z[home]! };
  const species = pool.species[index]!;
  const target = pickTargetNear(context, centre, FORAGE_RANGE, canBurrowerWalk(context, species));
  if (!target) return setMode(pool, index, BURROW_MODE.sentinel, 3);
  pool.targetX[index] = target.x;
  pool.targetZ[index] = target.z;
  setMode(pool, index, BURROW_MODE.forage, 8);
};

/** Next calm thing to do once up: watch, graze nearby, bask, or go below again. */
const chooseActivity = (pool: CritterPool, index: number, context: CritterContext) => {
  const { random } = context;
  const atHome =
    distanceTo(pool, index, pool.x[getHome(pool, index)]!, pool.z[getHome(pool, index)]!) <
    AT_HOME * 3;
  const roll = random();
  if (roll < 0.35) return startForage(pool, index, context);
  if (roll < 0.6) {
    pool.originX[index] = random();
    return setMode(pool, index, BURROW_MODE.sentinel, pickDuration(random, 2, 7));
  }
  if (roll < 0.78) return setMode(pool, index, BURROW_MODE.bask, pickDuration(random, 5, 16));
  if (atHome) return setMode(pool, index, BURROW_MODE.dive, DIVE_SECONDS);
  setMode(pool, index, BURROW_MODE.home, 12);
};

/** Walks (or runs) to the target; true on arrival or when blocked. */
const walkTo = (pool: CritterPool, index: number, context: CritterContext, speed: number) => {
  steerTowards(pool, index, pool.targetX[index]!, pool.targetZ[index]!, TURN_RATE, context.step);
  pool.speed[index] = speed;
  const moved = moveForward(
    pool,
    index,
    context.step,
    canBurrowerWalk(context, pool.species[index]!)
  );
  pool.pose[index] = pool.pose[index]! + (speed * context.step) / CYCLE;
  return !moved || distanceTo(pool, index, pool.targetX[index]!, pool.targetZ[index]!) < AT_HOME;
};

const runHome = (pool: CritterPool, index: number, context: CritterContext, speed: number) => {
  const home = getHome(pool, index);
  pool.targetX[index] = pool.x[home]!;
  pool.targetZ[index] = pool.z[home]!;
  if (!walkTo(pool, index, context, speed)) return;
  pool.x[index] = pool.x[home]!;
  pool.z[index] = pool.z[home]!;
  setMode(pool, index, BURROW_MODE.dive, DIVE_SECONDS);
};

const checkThreat = (pool: CritterPool, index: number, context: CritterContext) => {
  const mode = pool.mode[index]!;
  if (mode === BURROW_MODE.dive || mode === BURROW_MODE.home) return;
  if (!context.findThreat(pool.x[index]!, pool.z[index]!, THREAT_RADIUS)) return;
  if (mode === BURROW_MODE.down) {
    pool.timer[index] = Math.max(pool.timer[index]!, SCARED_SECONDS[0]);
    return;
  }
  setMode(pool, index, BURROW_MODE.home, 12);
  pool.speed[index] = RUN_SPEED;
};

/** Clip and pose of the calm modes (the walking ones advance their own gait phase). */
const CLIP_OF: Record<number, number> = {
  [BURROW_MODE.down]: CLIP.air,
  [BURROW_MODE.emerge]: CLIP.air,
  [BURROW_MODE.sentinel]: CLIP.look,
  [BURROW_MODE.forage]: CLIP.move,
  [BURROW_MODE.graze]: CLIP.feed,
  [BURROW_MODE.bask]: CLIP.rest,
  [BURROW_MODE.home]: CLIP.fast,
  [BURROW_MODE.dive]: CLIP.air
};

const setClip = (pool: CritterPool, index: number) => {
  const clip = CLIP_OF[pool.mode[index]!]!;
  if (clip === pool.clip[index]) return;
  pool.clip[index] = clip;
  pool.pose[index] = clip === CLIP.look ? 0.5 : 0;
};

const updatePose = (pool: CritterPool, index: number, context: CritterContext) => {
  const mode = pool.mode[index]!;
  const { step } = context;
  if (mode === BURROW_MODE.emerge)
    pool.pose[index] = Math.min(1, pool.pose[index]! + step / EMERGE_SECONDS);
  if (mode === BURROW_MODE.dive)
    pool.pose[index] = 1 - Math.min(1, 1 - pool.timer[index]! / DIVE_SECONDS);
  if (mode === BURROW_MODE.graze || mode === BURROW_MODE.bask)
    pool.pose[index] = approach(pool.pose[index]!, 1, step * 2);
  if (mode === BURROW_MODE.sentinel) {
    if (context.random() < step * 0.6) pool.originX[index] = context.random();
    pool.pose[index] = approach(pool.pose[index]!, pool.originX[index]!, step * 1.4);
  }
};

const finishMode = (pool: CritterPool, index: number, context: CritterContext) => {
  const mode = pool.mode[index]!;
  if (mode === BURROW_MODE.down) {
    pool.hidden[index] = 0;
    pool.pose[index] = 0;
    pool.originX[index] = 0.5;
    return setMode(pool, index, BURROW_MODE.emerge, EMERGE_SECONDS);
  }
  if (mode === BURROW_MODE.emerge)
    return setMode(pool, index, BURROW_MODE.sentinel, pickDuration(context.random, 2, 6));
  if (mode === BURROW_MODE.dive) return goDown(pool, index, context, false);
  chooseActivity(pool, index, context);
};

const updateMarmot = (pool: CritterPool, index: number, context: CritterContext) => {
  checkThreat(pool, index, context);
  pool.timer[index] = pool.timer[index]! - context.step;
  const mode = pool.mode[index]!;
  if (mode === BURROW_MODE.forage && walkTo(pool, index, context, WALK_SPEED)) {
    setMode(pool, index, BURROW_MODE.graze, pickDuration(context.random, 2, 7));
  } else if (mode === BURROW_MODE.home)
    runHome(pool, index, context, Math.max(WALK_SPEED, pool.speed[index]!));
  else if (pool.timer[index]! <= 0) finishMode(pool, index, context);
  setClip(pool, index);
  updatePose(pool, index, context);
  if (pool.mode[index] !== BURROW_MODE.home && pool.mode[index] !== BURROW_MODE.forage)
    pool.speed[index] = 0;
};

/** One step of a burrow member: the mound stays, the marmots live their day. */
export const updateBurrower = (pool: CritterPool, index: number, context: CritterContext) => {
  if (pool.species[index] !== CRITTER.burrow) updateMarmot(pool, index, context);
  pool.y[index] = context.terrain.ground(pool.x[index]!, pool.z[index]!);
};

export const spawnBurrower = (pool: CritterPool, index: number, context: CritterContext) => {
  pool.clip[index] = CLIP.idle;
  pool.lift[index] = 0;
  if (pool.species[index] === CRITTER.burrow) return setMode(pool, index, BURROW_MODE.mound, 0);
  pool.clip[index] = CLIP.air;
  pool.pose[index] = 0;
  goDown(pool, index, context, false);
  pool.timer[index] = pool.timer[index]! * 0.3;
};
