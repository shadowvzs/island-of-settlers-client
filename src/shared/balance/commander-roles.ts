import type { CommanderRole } from "../settlement/commander/commander-types";

/**
 * Role groups and tactical positions of the computer commander (A14 plan §3.1-§3.2). Distances in tiles,
 * scores in the commander's utility units. The same on every level: difficulty changes weights and
 * reaction time only (A14-5), never the candidate counts.
 */

/** A role change needs this margin: the reserve swap (plan `ROLE_COMMITMENT`). */
export const ROLE_COMMITMENT = 0.15;
/** A group below this health share stands in reserve (when another group still holds the front). */
export const RESERVE_HEALTH = 0.4;
/** A group whose mean morale is below this stands in reserve (plan §4.3); a standing reserve needs this much more. */
export const RESERVE_MORALE = 35;
export const RESERVE_MORALE_COMMITMENT = 10;
/** Churn guard: a group keeps its point for this many decisions after an order in the same mode and role. */
export const ORDER_HOLD_DECISIONS = 3;

/** Known enemies this close (tiles) to the nearest one form the enemy group the roles face. */
export const ENEMY_GROUP_RADIUS = 8;

/** Attack: the front's contact point lies this far short of the enemy centre, stepped by `LINE_STEPS`. */
export const CONTACT_DISTANCE = 3;
export const LINE_STEPS: readonly number[] = [-2, 0, 2];
/** Attack: overwatch points in bow band from the enemy centre, rotated off the line (degrees). */
export const OVERWATCH_RANGE = 7.5;
/** Attack (A14-2): overwatch points stay at least this far behind the squad's steady front (from the enemy). */
export const OVERWATCH_BEHIND_FRONT = 2;
export const OVERWATCH_ANGLES: readonly number[] = [-40, -15, 15, 40];
/** Attack: flank points this far out at right angles to the enemy facing (at least; see `FLANK_MARGIN`). */
export const FLANK_DISTANCE = 8;
/**
 * Attack (A14-2): the flank goes round the end of the enemy line, this far beyond its lateral extent, level with
 * the enemy's ranged group (its archers within `RANGED_GROUP_RADIUS` of the enemy centre).
 */
export const FLANK_MARGIN = 3;
export const RANGED_GROUP_RADIUS = 12;
/** A flank group this near its flank point strikes the ranged group (attack-moves on it). */
export const FLANK_ARRIVED = 3;
/**
 * A striking flank group stays out of its squad's retreat for at most this many seconds, while an enemy archer is
 * within `STRIKE_REACH` of it (its morale still wins: wavering soldiers are not the commander's).
 */
export const STRIKE_SECONDS = 8;
export const STRIKE_REACH = 12;
/**
 * Attack: reserve points this far from the enemy centre on the line through the group (A14-2: straight behind the
 * group; a group already further back keeps its distance, the second point 4 tiles behind it).
 */
export const RESERVE_DISTANCES: readonly number[] = [10, 14];

/** Defend: the front stands this far out from the post towards the enemy, stepped by `LINE_STEPS`. */
export const DEFEND_FRONT = 3;
/** Defend: overwatch stays this near the post, rotated off the line by `OVERWATCH_ANGLES`. */
export const DEFEND_OVERWATCH = 2;
/** Defend: flank points this far out to the sides of the post. */
export const DEFEND_FLANK = 4;
/** Defend: reserve points this far behind the post. */
export const DEFEND_RESERVE: readonly number[] = [2, 4];

/** A role group with an enemy known only by its hit alert this near (tiles) is under unseen fire. */
export const ALERT_FIRE_RANGE = 12;
/** Extra exposure (as an influence share) of the current place of a group under unseen fire (plan §6). */
export const ALERT_EXPOSURE = 1;

/** A height advantage over the enemy centre counts up to this much (world units). */
export const HEIGHT_CAP = 3;

export interface RolePositionWeights {
  /** Own and enemy influence at the point, each as a share of the cell's total (0-1). */
  support: number;
  exposure: number;
  /** Per world unit of height above the enemy centre (capped at `HEIGHT_CAP`). */
  height: number;
  /** The point lies in the role's distance band. */
  reach: number;
  /** Per influence cell walked from the group's centre. */
  travel: number;
  /** Enemy influence share on the straight way there (three samples, flank only). */
  flankRisk: number;
  /** The point is within `RETARGET` of the group's previous point. */
  commitment: number;
}

const weightsOf = (exposure: number, height: number, flankRisk = 0): RolePositionWeights => ({
  commitment: 0.3,
  exposure,
  flankRisk,
  height,
  reach: 2,
  support: 1,
  travel: 0.05
});

export const ROLE_POSITION_WEIGHTS: Readonly<Record<CommanderRole, RolePositionWeights>> = {
  flank: weightsOf(1, 0, 1),
  front: weightsOf(0.5, 0.15),
  overwatch: weightsOf(1.5, 0.4),
  reserve: weightsOf(2, 0)
};

/** A role's distance band: [nearest, farthest] tiles from the frame's reference point. */
export type RoleBand = readonly [number, number];

/** Attack bands, measured from the enemy centre. */
export const ATTACK_BANDS: Readonly<Record<CommanderRole, RoleBand>> = {
  flank: [5, 11],
  front: [0, 5.5],
  overwatch: [6, 9.5],
  reserve: [10, 20]
};

/** Defend bands, measured from the post. */
export const DEFEND_BANDS: Readonly<Record<CommanderRole, RoleBand>> = {
  flank: [2, 6],
  front: [0.5, 5.5],
  overwatch: [0, 3.5],
  reserve: [0, 5]
};
