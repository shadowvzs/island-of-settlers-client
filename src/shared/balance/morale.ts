/**
 * Field soldier morale (A14 plan §4). Integers only: morale is 0-100, distances in tiles, times in game ticks
 * (20 per second). The rules are the same for every faction and every commander level (owner 2026-11-13, Q1);
 * the levels only weigh how much the commander uses morale (`CommanderProfile.moraleUse`).
 */

/** Morale states, mildest first: steady, shaken (hesitates), wavering (falls back), broken (routs). */
export const MORALE_STEADY = 0;
export const MORALE_SHAKEN = 1;
export const MORALE_WAVERING = 2;
export const MORALE_BROKEN = 3;
export type MoraleState = typeof MORALE_STEADY | typeof MORALE_SHAKEN | typeof MORALE_WAVERING | typeof MORALE_BROKEN;

/** A state is entered below its enter value; it is left again at its leave value (hysteresis +10). */
export const MORALE_ENTER: readonly number[] = [101, 50, 30, 15];
export const MORALE_LEAVE: readonly number[] = [0, 60, 40, 25];

/** Target morale: base, per rank, and a soldier untouched so far (a fresh soldier starts at its base). */
export const MORALE_BASE = 70;
export const MORALE_PER_RANK = 5;
/** A friendly commander hero within its aura radius. */
export const MORALE_AURA = 15;
/** Within this many tiles of an own manned military building. */
export const MORALE_FORT = 5;
export const MORALE_FORT_RADIUS = 8;
/** Each friendly death within `MORALE_DEATH_RADIUS` in the last `MORALE_DEATH_TICKS` (capped); a routed neighbour. */
export const MORALE_DEATH = 8;
export const MORALE_DEATH_CAP = 24;
export const MORALE_ROUTED_NEIGHBOUR = 6;
export const MORALE_DEATH_RADIUS = 8;
export const MORALE_DEATH_TICKS = 200;
/** Falls remembered per faction (a ring: the oldest is overwritten). */
export const MORALE_DEATH_RING = 64;
/** Encirclement: known enemies within this radius in at least `LIGHT`/`HEAVY` of 8 sectors. */
export const MORALE_ENCIRCLE_RADIUS = 5;
export const MORALE_ENCIRCLE_LIGHT_SECTORS = 4;
export const MORALE_ENCIRCLE_HEAVY_SECTORS = 6;
export const MORALE_ENCIRCLE_LIGHT = 10;
export const MORALE_ENCIRCLE_HEAVY = 20;
/** Outnumbered: known enemy strength over own strength within the radius, ×100 (integers). */
export const MORALE_OUTNUMBER_RADIUS = 8;
export const MORALE_OUTNUMBER_LIGHT_RATIO = 200;
export const MORALE_OUTNUMBER_HEAVY_RATIO = 300;
export const MORALE_OUTNUMBER_LIGHT = 15;
export const MORALE_OUTNUMBER_HEAVY = 25;
/** Own health share below this (×100). */
export const MORALE_WOUNDED_PERCENT = 30;
export const MORALE_WOUNDED = 10;

/** Morale moves towards its target by these steps per update (fast fall, slow recovery). */
export const MORALE_FALL = 8;
export const MORALE_RISE = 2;
/** A soldier's morale is updated once per this many ticks (its rescore slot). */
export const MORALE_UPDATE_TICKS = 8;

/**
 * Rally: no known enemy within `MORALE_OUTNUMBER_RADIUS` for this many ticks (counted per update; an aura counts
 * double).
 */
export const MORALE_CALM_TICKS = 80;
export const MORALE_AURA_CALM_FACTOR = 2;

/** A wavering soldier falls back this far; a broken one runs this far (A14-3 replaces it with the covered route). */
export const MORALE_FALL_BACK_DISTANCE = 6;
export const MORALE_ROUT_DISTANCE = 14;
/** A wavering role group falls back as a whole when this share (percent) of it wavers or worse. */
export const MORALE_GROUP_FALL_BACK_PERCENT = 50;
/** Soldiers of one faction and troop type this near (tiles) count as one role group for the fall-back. */
export const MORALE_GROUP_RADIUS = 6;
/**
 * A14-3 "archers check first": own archers this near (tiles) behind a melee group that falls back step back first.
 * Wider (8) pulled the hill overwatch off its ridge (A14-1 gate share 0.18 instead of 0.41).
 */
export const MORALE_ARCHER_COVER_RADIUS = 4;
/** A player soldier ordered within this many ticks (3 s) skips the fall-back (the order wins); it may still rout. */
export const MORALE_ORDER_GRACE_TICKS = 60;
/** A broken soldier still fights an enemy this close (cornered; A14-3 adds the blocked-route part). */
export const MORALE_CORNERED_RANGE = 1.5;
/** Shaken: the acquire radius is capped at the guard radius and the leash at this many tiles. */
export const MORALE_SHAKEN_LEASH = 4;

/** A broken soldier counts with this share of its strength in its side's influence and squads. */
export const MORALE_BROKEN_STRENGTH = 0.25;
