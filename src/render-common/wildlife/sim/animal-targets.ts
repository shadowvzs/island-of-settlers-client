import { DMath } from "../../../shared/math/deterministic-math";
import { randomInRange } from "../../../shared/world/rng";
import { isReachable, isSegmentWalkable,isStandFree } from "../nav/nav-query";
import { getSpecies } from "../wildlife-species";
import { isYoung } from "./animal-age";
import { sampleHabitat } from "./animal-habitat";
import { pickGaussian, planRoute, type WildlifeContext } from "./wildlife-context";

const WANDER_TRIES = 6;
/** Spread of a new wander direction around the current heading (radians, one deviation). */
const WANDER_ARC = 0.9;
const ESCAPE_DIRECTIONS = 12;
/** Distance to the leader of a follow spot, in personal spaces (the young stay at heel). */
const YOUNG_FOLLOW = [0.5, 1.1] as const;
const ADULT_FOLLOW = [1, 2.5] as const;
/** Escape run lengths tried in turn (a shorter one when the long ones are all blocked). */
const ESCAPE_REACHES = [7, 3.5] as const;

/** Scratch candidate and spot (no allocation). */
const best = { score: -Infinity, x: 0, z: 0 };
const spot = { x: 0, z: 0 };

const resetBest = () => {
  best.score = -Infinity;
};

const offer = (score: number, x: number, z: number) => {
  if (score <= best.score) return;
  best.score = score;
  best.x = x;
  best.z = z;
};

/** Direction of the next leg: within an arc of the heading, back towards home when strayed. */
const pickWanderAngle = (context: WildlifeContext, animal: number) => {
  const { pool, random } = context;
  const homeDx = pool.homeX[animal]! - pool.x[animal]!;
  const homeDz = pool.homeZ[animal]! - pool.z[animal]!;
  const strayed = DMath.hypot(homeDx, homeDz) > pool.homeRange[animal]!;
  const base = strayed ? DMath.atan2(homeDz, homeDx) : pool.heading[animal]!;
  return base + pickGaussian(random.at("wildlife.wanderAngle", animal)) * WANDER_ARC * (strayed ? 0.5 : 1);
};

/** Followers drift to a spot near their leader (loose herd, preferred distance). */
const pickFollowSpot = (context: WildlifeContext, animal: number, leader: number) => {
  const { pool, random } = context;
  const profile = getSpecies(pool.species[animal]!);
  const angle = random.at("wildlife.followSpot", animal)() * Math.PI * 2;
  const near = isYoung(pool, animal) ? YOUNG_FOLLOW : ADULT_FOLLOW;
  const distance = profile.personalSpace * (near[0] + random() * (near[1] - near[0]));
  spot.x = pool.x[leader]! + DMath.cos(angle) * distance;
  spot.z = pool.z[leader]! + DMath.sin(angle) * distance;
};

/** Candidate end of a wander leg into `spot`. */
const pickWanderSpot = (context: WildlifeContext, animal: number, followLeader: boolean) => {
  const { pool, random } = context;
  const leader = pool.group[animal]!;
  if (followLeader && leader !== animal) {
    pickFollowSpot(context, animal, leader);
    return;
  }
  const angle = pickWanderAngle(context, animal);
  const range = getSpecies(pool.species[animal]!).wanderDistance;
  const distance = randomInRange(random.at("wildlife.wanderDistance", animal), range) * pool.wanderScale[animal]!;
  spot.x = pool.x[animal]! + DMath.cos(angle) * distance;
  spot.z = pool.z[animal]! + DMath.sin(angle) * distance;
};

/**
 * Next wander leg: a few candidates around the heading (or towards the leader), each on free
 * ground in the same connected region, scored by habitat with a little randomness. Plans the
 * route; false when no candidate works (the animal just keeps standing).
 */
export const startWanderLeg = (context: WildlifeContext, animal: number, followLeader: boolean) => {
  const { nav, pool, random } = context;
  const species = pool.species[animal]!;
  const x = pool.x[animal]!;
  const z = pool.z[animal]!;
  resetBest();
  for (let attempt = 0; attempt < WANDER_TRIES; attempt += 1) {
    pickWanderSpot(context, animal, followLeader);
    const targetX = spot.x;
    const targetZ = spot.z;
    if (!isStandFree(nav, species, targetX, targetZ)) continue;
    if (!isReachable(nav, species, x, z, targetX, targetZ)) continue;
    const straight = isSegmentWalkable(nav, species, x, z, targetX, targetZ) ? 0.25 : 0;
    const habitat = sampleHabitat(context.field, species, targetX, targetZ);
    offer(habitat + straight + random.at("wildlife.wanderScore", animal)() * 0.3, targetX, targetZ);
  }
  if (best.score === -Infinity) return false;
  return planRoute(context, animal, best.x, best.z);
};

/**
 * Escape vector: directions fanned around "away from the threat", each end point on free,
 * reachable ground; scored by the distance gained, the current heading (no zig-zag), the herd
 * leader's flight and a straight run. Never straight into a cliff: blocked ends are skipped.
 */
export const startEscape = (context: WildlifeContext, animal: number) => {
  const { nav, pool } = context;
  const species = pool.species[animal]!;
  const x = pool.x[animal]!;
  const z = pool.z[animal]!;
  const threatX = pool.threatX[animal]!;
  const threatZ = pool.threatZ[animal]!;
  const away = DMath.atan2(z - threatZ, x - threatX);
  const leader = pool.group[animal]!;
  const leaderFleeing = leader !== animal && pool.active[leader] === 1;
  const before = DMath.hypot(x - threatX, z - threatZ);
  for (const reach of ESCAPE_REACHES) {
    resetBest();
    for (let step = 0; step < ESCAPE_DIRECTIONS; step += 1) {
      const angle = away + ((step - ESCAPE_DIRECTIONS / 2) / ESCAPE_DIRECTIONS) * Math.PI * 1.6;
      const endX = x + DMath.cos(angle) * reach;
      const endZ = z + DMath.sin(angle) * reach;
      if (!isStandFree(nav, species, endX, endZ)) continue;
      if (!isReachable(nav, species, x, z, endX, endZ)) continue;
      const gain = (DMath.hypot(endX - threatX, endZ - threatZ) - before) / reach;
      const inertia = DMath.cos(angle - pool.heading[animal]!) * 0.3;
      const herd = leaderFleeing ? DMath.cos(angle - pool.heading[leader]!) * 0.35 : 0;
      const straight = isSegmentWalkable(nav, species, x, z, endX, endZ) ? 0.3 : 0;
      offer(gain + inertia + herd + straight, endX, endZ);
    }
    if (best.score > -Infinity && planRoute(context, animal, best.x, best.z)) return true;
  }
  return false;
};
