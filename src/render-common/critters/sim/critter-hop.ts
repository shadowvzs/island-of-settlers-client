import { randomBetween } from "../../../shared/world/rng";
import { CLIP } from "../model/critter-model";
import { type CritterContext,pickDuration, pickTargetNear } from "./critter-context";
import type { CritterPool } from "./critter-pool";

/**
 * Frogs on river and pond banks: they sit still for long stretches, now and then hop along the
 * bank, or leap into the water with a splash and stay under a while before climbing out again
 * somewhere along their bank. Someone close sends them plopping into the water at once.
 * Pool use: origin = hop start, target = hop end, clock = hop length (seconds).
 */
const HOP_MODE = { sit: 0, hop: 1, under: 2 } as const;

const SIT_SECONDS = [3, 16] as const;
const UNDER_SECONDS = [5, 16] as const;
const HOP_SECONDS = 0.42;
const HOP_HEIGHT = 0.07;
const HOP_REACH = 0.45;
const DIVE_REACH = 0.7;
const BANK_RANGE = 1.4;
const THREAT_RADIUS = 2.6;
const DIVE_SHARE = 0.3;
/** A bank spot: dry ground with water within this reach. */
const WATER_NEAR = 0.45;

const isWater = (context: CritterContext, x: number, z: number) =>
  context.terrain.depth(x, z) > 0.06;

/** Dry ground right beside the water (where a frog sits). */
export const canSitOnBank = (context: CritterContext) => (x: number, z: number) => {
  if (context.terrain.depth(x, z) > 0.01) return false;
  return (
    isWater(context, x + WATER_NEAR, z) ||
    isWater(context, x - WATER_NEAR, z) ||
    isWater(context, x, z + WATER_NEAR) ||
    isWater(context, x, z - WATER_NEAR)
  );
};

const sit = (pool: CritterPool, index: number, context: CritterContext) => {
  pool.mode[index] = HOP_MODE.sit;
  pool.hidden[index] = 0;
  pool.clip[index] = CLIP.idle;
  pool.timer[index] = pickDuration(context.random, ...SIT_SECONDS);
};

const startHop = (pool: CritterPool, index: number, context: CritterContext, dive: boolean) => {
  const from = { x: pool.x[index]!, z: pool.z[index]! };
  const accept = dive ? (x: number, z: number) => isWater(context, x, z) : canSitOnBank(context);
  const target = pickTargetNear(context, from, dive ? DIVE_REACH : HOP_REACH, accept);
  if (!target) return sit(pool, index, context);
  pool.originX[index] = from.x;
  pool.originZ[index] = from.z;
  pool.targetX[index] = target.x;
  pool.targetZ[index] = target.z;
  pool.heading[index] = Math.atan2(target.z - from.z, target.x - from.x);
  pool.mode[index] = HOP_MODE.hop;
  pool.clip[index] = CLIP.air;
  pool.timer[index] = HOP_SECONDS;
};

/** Along the arc: position, height and the leap pose (crouched .. stretched .. crouched). */
const flyHop = (pool: CritterPool, index: number, context: CritterContext) => {
  const t = Math.min(1, 1 - pool.timer[index]! / HOP_SECONDS);
  const x = pool.originX[index]! + (pool.targetX[index]! - pool.originX[index]!) * t;
  const z = pool.originZ[index]! + (pool.targetZ[index]! - pool.originZ[index]!) * t;
  pool.x[index] = x;
  pool.z[index] = z;
  pool.lift[index] = Math.sin(Math.PI * t) * HOP_HEIGHT;
  pool.pose[index] = Math.sin(Math.PI * t);
  pool.y[index] = context.terrain.water(x, z) + pool.lift[index]!;
};

const land = (pool: CritterPool, index: number, context: CritterContext) => {
  pool.lift[index] = 0;
  const x = pool.x[index]!, z = pool.z[index]!;
  if (!isWater(context, x, z)) return sit(pool, index, context);
  context.emitRipple(x, z, 0.3);
  pool.mode[index] = HOP_MODE.under;
  pool.hidden[index] = 1;
  pool.timer[index] = randomBetween(context.random, ...UNDER_SECONDS);
};

/** Back out of the water onto its bank, with a little ring where it climbs out. */
const surface = (pool: CritterPool, index: number, context: CritterContext) => {
  const site = context.sites[pool.site[index]!]!;
  const spot = pickTargetNear(context, site, BANK_RANGE, canSitOnBank(context));
  if (!spot) {
    pool.timer[index] = 2;
    return;
  }
  pool.x[index] = spot.x;
  pool.z[index] = spot.z;
  pool.heading[index] = context.random() * Math.PI * 2;
  context.emitRipple(spot.x, spot.z, 0.12);
  sit(pool, index, context);
};

const checkThreat = (pool: CritterPool, index: number, context: CritterContext) => {
  if (pool.mode[index] !== HOP_MODE.sit) return;
  if (context.findThreat(pool.x[index]!, pool.z[index]!, THREAT_RADIUS)) {
    startHop(pool, index, context, true);
  }
};

/** One step of a frog. */
export const updateHopper = (pool: CritterPool, index: number, context: CritterContext) => {
  checkThreat(pool, index, context);
  pool.timer[index] = pool.timer[index]! - context.step;
  const mode = pool.mode[index]!;
  if (mode === HOP_MODE.hop) flyHop(pool, index, context);
  else pool.y[index] = context.terrain.water(pool.x[index]!, pool.z[index]!);
  if (pool.timer[index]! > 0) return;
  if (mode === HOP_MODE.hop) return land(pool, index, context);
  if (mode === HOP_MODE.under) return surface(pool, index, context);
  startHop(pool, index, context, context.random() < DIVE_SHARE);
};

export const spawnHopper = (pool: CritterPool, index: number, context: CritterContext) => {
  pool.lift[index] = 0;
  pool.pose[index] = 0;
  sit(pool, index, context);
};
