import { type Flock, type FlockContext,setFlockMode } from "./bird-flock";
import type { BirdHistory, BirdPool } from "./bird-pool";
import { placeMembers, startFlight } from "./bird-spawner";
import { BIRD_SPECIES } from "./bird-species";
import { isInView } from "./bird-view";

const VIEW_MARGIN = 3;
const RECYCLE_SECONDS = 1.5;

/**
 * A flock's life after its spawn: occasional splits, landing and resting, taking off again,
 * and the recycling of flocks the view left (their birds return to the pool).
 */
export const createFlockLifecycle = (
  context: FlockContext,
  pool: BirdPool,
  history: BirdHistory
) => {
  const { random, region, step } = context;

  const releaseFlock = (flock: Flock) => {
    context.buildings?.releaseRoof(flock);
    flock.roof = null;
    flock.active = false;
    for (let member = 0; member < flock.size; member += 1) {
      const bird = flock.members[member]!;
      pool.flock[bird] = -1;
      pool.appear[bird] = 0;
      history.appear[bird] = 0;
    }
  };

  /** Rest is over: take off again from the perch if it is still in view and daytime. */
  const endRest = (flock: Flock) => {
    const inView = isInView(region, flock.landX, flock.landY, flock.landZ, 0);
    if (!inView || context.activity < 0.4) {
      releaseFlock(flock);
      return;
    }
    flock.x = flock.landX;
    flock.y = flock.landY;
    flock.z = flock.landZ;
    flock.heading = random() * Math.PI * 2;
    flock.speed = BIRD_SPECIES[flock.species]!.speed * 0.35;
    startFlight(flock, BIRD_SPECIES[flock.species]!, random);
    setFlockMode(flock, "takeoff", Infinity);
    if (flock.roof) {
      // Take off from visible individual ridge slots, preserving the frame history.
      for (let member = 0; member < flock.size; member++) {
        const bird = flock.members[member]!;
        pool.settle[bird] = -1;
        pool.delay[bird] = member * 0.12;
        pool.appear[bird] = 1;
        pool.gliding[bird] = 0;
        pool.flap[bird] = 0.2;
      }
    } else placeMembers(pool, history, flock, true, random);
  };

  const allSettled = (flock: Flock) => {
    for (let member = 0; member < flock.size; member += 1)
      if (pool.settle[flock.members[member]!]! < 1) return false;
    return true;
  };

  const anyMemberInView = (flock: Flock) => {
    for (let member = 0; member < flock.size; member += 1) {
      const bird = flock.members[member]!;
      if (isInView(region, pool.x[bird]!, pool.y[bird]!, pool.z[bird]!, VIEW_MARGIN)) return true;
    }
    return isInView(region, flock.x, flock.y, flock.z, VIEW_MARGIN);
  };

  /** Occasionally one or a few birds drift off to a side and later rejoin. */
  const updateSplit = (flock: Flock) => {
    if (flock.size < 3 || flock.mode !== "wander") return;
    flock.splitTimer -= step;
    if (flock.splitTimer > 0) return;
    flock.splitTimer = 8 + random() * 14;
    const side = random() < 0.5 ? -1 : 1;
    const leavers = 1 + Math.floor(random() * Math.floor(flock.size / 2));
    for (let member = 0; member < leavers; member += 1) {
      const bird = flock.members[flock.size - 1 - member]!;
      pool.detach[bird] = 3 + random() * 3;
      pool.detachSide[bird] = side;
    }
  };

  /** Recycles flocks out of view; landed flocks rest, then take off again or leave. */
  const updateLifecycle = (flock: Flock) => {
    if (flock.mode === "land" && allSettled(flock)) setFlockMode(flock, "rest", 4 + random() * 10);
    if (flock.mode === "rest") {
      if (flock.modeTime > flock.modeLength) endRest(flock);
      return;
    }
    flock.outOfView = anyMemberInView(flock) ? 0 : flock.outOfView + step;
    if (flock.outOfView > RECYCLE_SECONDS && flock.age > 4) releaseFlock(flock);
  };

  return { releaseFlock, updateLifecycle, updateSplit };
};
