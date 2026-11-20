import { BEHAVIOUR, CRITTER_COLONIES } from "../critter-colonies";
import type { CritterSite } from "../habitat/critter-sites";
import { canBurrowerWalk, spawnBurrower, updateBurrower } from "./critter-burrow";
import { spawnClimber, updateClimber } from "./critter-climb";
import { type CritterContext,pickTargetNear } from "./critter-context";
import { canDart, spawnDarter, updateDarter } from "./critter-dart";
import { canHaul, spawnHauler, updateHauler } from "./critter-haul";
import { canSitOnBank, spawnHopper, updateHopper } from "./critter-hop";
import { canLeapFrom, spawnLeaper, updateLeaper } from "./critter-leap";
import type { CritterPool } from "./critter-pool";
import { canRoamInGlade, canWalkGround, spawnRoamer, updateRoamer } from "./critter-roam";
import { canScuttle, spawnScuttler, updateScuttler } from "./critter-scuttle";
import { canSoar, spawnSoarer, updateSoarer } from "./critter-soar";
import { canStalk, spawnStalker, updateStalker } from "./critter-stalk";
import { canSwim, spawnSwimmer, updateSwimmer } from "./critter-swim";

/** A behaviour's start state, step, and where its members may be placed. */
export interface CritterBehaviour {
  /** Where a member of `species` may stand or swim. */
  accepts: (context: CritterContext, species: number) => (x: number, z: number) => boolean;
  spawn: (pool: CritterPool, index: number, context: CritterContext) => void;
  update: (pool: CritterPool, index: number, context: CritterContext) => void;
}

/** Indexed by BEHAVIOUR. */
export const CRITTER_BEHAVIOURS: readonly CritterBehaviour[] = [
  { accepts: canSwim, spawn: spawnSwimmer, update: updateSwimmer },
  { accepts: canStalk, spawn: spawnStalker, update: updateStalker },
  { accepts: canStalk, spawn: spawnStalker, update: updateStalker },
  { accepts: canLeapFrom, spawn: spawnLeaper, update: updateLeaper },
  { accepts: canRoamInGlade, spawn: spawnRoamer, update: updateRoamer },
  { accepts: canWalkGround, spawn: spawnClimber, update: updateClimber },
  { accepts: canSoar, spawn: spawnSoarer, update: updateSoarer },
  { accepts: canBurrowerWalk, spawn: spawnBurrower, update: updateBurrower },
  { accepts: canSitOnBank, spawn: spawnHopper, update: updateHopper },
  { accepts: canScuttle, spawn: spawnScuttler, update: updateScuttler },
  { accepts: canHaul, spawn: spawnHauler, update: updateHauler },
  { accepts: canDart, spawn: spawnDarter, update: updateDarter }
];

const FOLLOWER_SPREAD = 0.5;
const FOLLOWER_ATTEMPTS = 6;

/** A free spot just around the leader (wider with every miss), else the leader's own. */
const placeFollower = (
  context: CritterContext,
  accepts: (x: number, z: number) => boolean,
  leader: { x: number; z: number }
) => {
  for (let attempt = 0; attempt < FOLLOWER_ATTEMPTS; attempt += 1) {
    const spread = FOLLOWER_SPREAD * (1 + attempt * 0.4);
    const x = leader.x + (context.random() - 0.5) * spread;
    const z = leader.z + (context.random() - 0.5) * spread;
    if (accepts(x, z)) return { x, z };
  }
  return { x: leader.x, z: leader.z };
};

/**
 * Start point of a member: the leader (member 0) somewhere near the site centre (searching the
 * colony's whole range before falling back to the centre), followers of a swimming or roaming
 * group just around it, everyone else on their own spot near the site.
 */
export const placeMember = (
  context: CritterContext,
  site: CritterSite,
  behaviour: number,
  species: number,
  leader: { x: number; z: number } | null
) => {
  const accepts = CRITTER_BEHAVIOURS[behaviour]!.accepts(context, species);
  if (leader && behaviour === BEHAVIOUR.burrow) return { x: leader.x, z: leader.z };
  if (leader && (behaviour === BEHAVIOUR.swim || behaviour === BEHAVIOUR.roam)) {
    return placeFollower(context, accepts, leader);
  }
  const range = leader ? 1.6 : 1.2;
  const near = pickTargetNear(context, site, range, accepts);
  if (near) return near;
  const wide = pickTargetNear(context, site, CRITTER_COLONIES[site.colony]!.range, accepts);
  return wide ?? { x: site.x, z: site.z };
};
