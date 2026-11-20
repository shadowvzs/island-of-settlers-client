import {
  createPointEvent,
  getCarcassFade,
  getDeathProgress,
  harvestCarcass,
  isCarcass,
  startDeathClock,
  stepDeathClock
} from "../../helpers";
import { CRITTER_SPECIES } from "../critter-species";
import { CLIP } from "../model/critter-model";
import type { CritterContext } from "./critter-context";
import type { CritterPool } from "./critter-pool";

/** A carcass sinks this many body radii into the ground while it fades out. */
const SINK_RADII = 1.5;
/** A kill startles the critters around (they flee or fly off) within this radius. */
const KILL_SCARE_RADIUS = 6;

/**
 * A killed food critter (wild boar, piglet, chamois) leaves the living: no behaviour, no
 * collision, its followers go their own way; it plays the shared death fall (CLIP.dead, the
 * timing of helpers.ts), lies as a carcass, then sinks into the ground. False when the
 * critter cannot be killed (not alive or not food).
 */
const startCritterCarcass = (pool: CritterPool, index: number) => {
  if (pool.active[index] === 0 || pool.carcass[index] === 1) return false;
  if (!CRITTER_SPECIES[pool.species[index]!]!.food) return false;
  startDeathClock(pool, index);
  pool.clip[index] = CLIP.dead;
  pool.pose[index] = 0;
  pool.speed[index] = 0;
  for (let other = 0; other < pool.capacity; other += 1) {
    if (pool.leader[other] === index) pool.leader[other] = -1;
  }
  return true;
};

/** One step of a carcass; false once it has faded out (the slot is to be freed). */
export const stepCritterCarcass = (pool: CritterPool, index: number, context: CritterContext) => {
  if (!stepDeathClock(pool, index, context.step)) return false;
  const seconds = pool.deathTime[index]!;
  const species = CRITTER_SPECIES[pool.species[index]!]!;
  const radius = species.bodyRadius * (pool.scale[index]! / species.size);
  const ground = context.terrain.ground(pool.x[index]!, pool.z[index]!);
  pool.pose[index] = getDeathProgress(seconds);
  pool.y[index] = ground - getCarcassFade(seconds) * radius * SINK_RADII;
  return true;
};

/**
 * The hunting API of the critter manager (no hunters yet; the wildlife offers the same):
 * kill a food critter, ask whether it lies dead, take its carcass away, hear of a kill.
 */
export const createCarcassActions = (
  pool: CritterPool,
  release: (index: number) => void,
  scare: (x: number, z: number, radius: number) => void
) => {
  const killed = createPointEvent();
  return {
    /** Takes a lying carcass away at once (hunters, butchers); false when there is none. */
    harvestCritter: (index: number) => {
      if (!harvestCarcass(pool, index)) return false;
      release(index);
      return true;
    },
    /** True while a killed critter lies dead (after its fall, before it fades). */
    isCarcass: (index: number) => isCarcass(pool, index),
    /**
     * Kills a living food critter (it falls, the critters around are startled, the kill
     * listeners hear of it); else false.
     */
    killCritter: (index: number) => {
      if (!startCritterCarcass(pool, index)) return false;
      scare(pool.x[index]!, pool.z[index]!, KILL_SCARE_RADIUS);
      killed.emit(pool.x[index]!, pool.z[index]!);
      return true;
    },
    /** A food critter was killed at (x, z) (birds nearby scatter). */
    onCritterKilled: killed.listen
  };
};
