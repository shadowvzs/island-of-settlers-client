import { secondsToTicks } from "../../../../island-of-settlers-shared/src/time/constants";

/**
 * Strategic director constants (A14 plan §5, lane A14-4a). The same on every level, except the four medium
 * values the commander profiles vary by level (`commander-profiles.ts`, A14-5): the interval, the raid ratio,
 * the uncertainty margin and the scout age. Balance is tuned in A14-8.
 */

/** Ticks between two decisions of a medium faction's director (plan §7: 6 s). */
export const DIRECTOR_INTERVAL_TICKS = secondsToTicks(6);
/** Factions are spread over this many slots of the interval (plan §5.1: offset 6·(faction % 8)/8 s). */
export const DIRECTOR_SLOTS = 8;
/** At most this many forces per computer faction (plan §5.1). */
export const MAX_FORCES = 3;
/** The current macro is kept unless another scores this much more (plan §5.1). */
export const MACRO_COMMITMENT = .2;

/** Staging: candidates on the line from the force's home towards its goal, at most this far (tiles). */
const STAGING_REACH = 20;
/** Staging candidates (≤ 12): [tiles along the line home → goal, tiles to its side]. */
export const STAGING_CANDIDATES: readonly (readonly [number, number])[] = [
  [0, 0], [4, 0], [8, 0], [12, 0], [16, 0], [STAGING_REACH, 0], [8, -4], [8, 4], [12, -4], [12, 4], [16, -4],
  [16, 4]
];
/** Staging candidates checked for clear ground, best first (plan §3.2 pattern). */
export const STAGING_CLEAR_CHECKS = 3;
/** A member this near (tiles) to the staging point has mustered. */
export const MUSTER_RADIUS = 6;
/** Muster ends after this long even when stragglers are missing (plan: ≤ 60 s; no reinforcement source yet). */
export const MUSTER_TICKS = secondsToTicks(20);
/** Own and known enemy strength around a staging candidate are summed within this radius (tiles). */
export const STAGING_SAMPLE_RADIUS = 8;

/** Scout goals visited per scouting trip (plan §5.1: ≤ 3). */
export const SCOUT_GOALS = 3;
/** A scout this near (tiles) to its goal has visited it. */
export const SCOUT_ARRIVAL = 4;
/** A scout under this health share turns back (the hit alert abort, plan §5.1). */
export const SCOUT_ABORT_HEALTH = .7;

/** Raid parties: at most this many soldiers, against a target of this tier or above (plan §5.1). */
export const RAID_PARTY_MAX = 6;
export const RAID_MIN_TIER = 3;
/** A medium raid strikes only while own strength ≥ known defence × (1 + margin · uncertainty) × this ratio. */
export const RAID_RATIO = 1.2;
export const UNCERTAINTY_MARGIN = .4;
/** A raid hits for at most this long, or until it lost this share of its strength (plan §5.1). */
export const RAID_HIT_TICKS = secondsToTicks(45);
export const RAID_LOSS_SHARE = .3;
/** Known enemies this near (tiles) to a target are its known defence. */
export const DEFENCE_RADIUS = 12;
/** After a target falls, the next known target within this radius (tiles) is struck (exploit). */
export const EXPLOIT_RADIUS = 18;

/** Regroup when the force spreads wider than this (tiles) or its mean morale falls below this. */
export const REGROUP_SPREAD = 12;
export const REGROUP_MORALE = 40;
/** A regroup ends once the spread is under this and the mean morale at least this, or after this long. */
export const REGROUPED_SPREAD = 6;
export const REGROUPED_MORALE = 50;
export const REGROUP_TICKS = secondsToTicks(30);
/** A known enemy this near (tiles) to the force's centre means contact: no regroup then. */
export const CONTACT_RADIUS = 12;

/** Defend when a known enemy stands this near (tiles) to the force's home (plan §5.1: 18). */
export const DEFEND_RADIUS = 18;
/** Withdraw below this share of the starting strength, or with this share of the members broken. */
export const WITHDRAW_STRENGTH = .35;
export const WITHDRAW_BROKEN = .6;
/** A withdrawing member this near (tiles) to home is home. */
export const HOME_ARRIVAL = 3;

/**
 * Macro scores (plan §5.1 order: withdraw > defend > regroup > raid > strike > scout > hold). Withdraw, defend
 * and regroup lie more than `MACRO_COMMITMENT` above a ready strike, so they interrupt it.
 */
export const MACRO_SCORES = Object.freeze({
  defend: 1.1, hold: .1, raid: .8, regroup: 1, scout: .5, strike: .6, strikeReady: .75, withdraw: 1.2
});

/**
 * Strategic knowledge (A14 plan §5.3, lane A14-4b): the map is cut into square sectors of this many tiles; a
 * sector was seen when a computer faction's layer covered its centre cell.
 */
export const SECTOR_TILES = 16;
/** A sector a medium faction has not seen for longer than this is stale: worth a scout's visit (plan §7). */
export const SCOUT_AGE_TICKS = secondsToTicks(60);
/** Stale sectors whose centre lies at most this far (tiles) from the scout's start are candidates. */
export const SCOUT_REACH = 80;
/** Candidate sector centres checked for clear ground per scout plan (best score first). */
export const SCOUT_CLEAR_CHECKS = 12;
/** A faction's scout plan is replaced once every goal was seen since it was made, or after this long. */
export const SCOUT_PLAN_TICKS = secondsToTicks(90);
/**
 * A known site's garrison as last seen is trusted fully when fresh and not at all after this long: the estimate
 * slides from what was seen towards the type's full garrison (plan §6, unknown defence = capacity).
 */
export const SITE_CERTAINTY_TICKS = secondsToTicks(120);

/** The economy AI hands a faction at most this many strategic intents (A14 plan §5.4, lane A14-4c). */
export const MAX_INTENTS = 4;
/** An attack intent musters until its strength goal is met, at most this long (plan §5.1: ≤ 60 s). */
export const INTENT_MUSTER_TICKS = secondsToTicks(60);
/** A faction's army requests name at most this many soldiers in all (plan §5.4). */
export const ARMY_REQUEST_SOLDIERS = 8;
/** A known enemy type is countered once this many are known and they are this share (%) of the known enemies. */
export const COUNTER_MIN_KNOWN = 4;
export const COUNTER_SHARE_PERCENT = 40;
/** One counter soldier is requested per this many known enemies of the countered type, per counter type. */
export const COUNTER_ENEMIES_PER_SOLDIER = 4;
/** Army request priorities (larger: more urgent). */
export const ARMY_REQUEST_PRIORITIES = Object.freeze({ counterComposition: 2, intentShortfall: 3, lossReplacement: 1 });
