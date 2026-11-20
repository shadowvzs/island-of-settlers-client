import { DMath } from "../math/deterministic-math";
import type { SettlementPoint } from "./settlement-types";

/**
 * Close-combat choreography (docs/archive/dated/military-motion-2026-10-13.md, step 3). Pure rules for how melee
 * soldiers gather round a foe so that a fight reads like a fight, not a blob:
 * - Engagement places: at most `MELEE_PLACES` attackers stand at a foe (fewer at a rider). The
 *   nearest claimants get them (a soldier already there keeps its place); the rest pick another foe
 *   or wait in a ring just out of reach, facing the fight, ready to step in.
 * - Places spread from the side the attackers come from (the first takes its own bearing, the next
 *   ones at least `PLACE_SPREAD` apart): a front forms instead of a ring of blades round one man.
 * - Staggered blows: a soldier's first blow at a new foe waits a share of its interval that depends
 *   on the pair, so neighbours do not swing in lockstep.
 * - Footwork: between blows a duellist steps back a little, and in again before the next blow.
 */
export interface EngagementClaim { uid: number; distance: number; holding: boolean }

/** Melee attackers at one foot soldier, and at one rider (a horse is fought from fewer sides). */
export const MELEE_PLACES = 3;
export const RIDER_PLACES = 2;
/** A soldier already holding a place counts this much nearer (tiles): places do not flicker. */
const HOLDING_BONUS = 1.5;
/** Minimum angle between two attackers' places round the same foe (radians, about 55 degrees). */
const PLACE_SPREAD = .96;
/** Place headings tried round the attacker's own bearing (radians). */
const PLACE_OFFSETS = [0, .44, -.44, .87, -.87, 1.31, -1.31, 1.75, -1.75];
/** The waiting ring lies this far beyond reach (tiles). */
export const RING_GAP = 1.3;
/** Footwork: the step back after a blow (tiles), taken while more than this share of the interval is left. */
const STEP_BACK = .22;
const STEP_BACK_SHARE = .45;
/** First blow at a new foe: delayed by this share of the interval, spread by the pair's hash. */
const STAGGER_MINIMUM = .15;
const STAGGER_SPREAD = .5;

const wrap = (angle: number) => DMath.atan2(DMath.sin(angle), DMath.cos(angle));

/** Whether `uid` gets one of the `places` at a foe claimed by `claims` (nearest first, holders favoured). */
export const holdsPlace = (claims: readonly EngagementClaim[], uid: number, places: number) => {
  let ahead = 0, own: EngagementClaim | undefined;
  for (const claim of claims) if (claim.uid === uid) own = claim;
  // Not counted yet (it picked the foe this tick): a place is free if fewer claimants hold them.
  if (!own) return claims.length < places;
  const key = (claim: EngagementClaim) => claim.distance - (claim.holding ? HOLDING_BONUS : 0);
  for (const claim of claims) {
    if (claim === own) continue;
    if (key(claim) < key(own) || (key(claim) === key(own) && claim.uid < uid)) ahead++;
  }
  return ahead < places;
};

/**
 * Heading (radians, from the foe) of a new attacker's place: its own bearing, or the nearest heading
 * at least `PLACE_SPREAD` from the places already taken (`taken`) that `isOpen` accepts; null if none.
 */
export const placeHeading = (bearing: number, taken: readonly number[], isOpen: (heading: number) => boolean) => {
  for (const offset of PLACE_OFFSETS) {
    const heading = wrap(bearing + offset);
    if (taken.every(other => Math.abs(wrap(heading - other)) >= PLACE_SPREAD) && isOpen(heading)) return heading;
  }
  return null;
};

/** The point `distance` from `foe` along `heading`. */
export const pointAround = (foe: SettlementPoint, heading: number, distance: number) =>
  ({ x: foe.x + DMath.cos(heading) * distance, z: foe.z + DMath.sin(heading) * distance });

/** How far a duellist stands from its foe: a step back right after a blow, at `standoff` before the next. */
export const footworkDistance = (standoff: number, reach: number, cooldown: number, interval: number) => {
  if (cooldown <= interval * STEP_BACK_SHARE) return standoff;
  return Math.min(reach - .02, standoff + STEP_BACK);
};

/** Share of its interval a soldier waits before its first blow at a new foe (deterministic per pair). */
export const staggerShare = (uid: number, foe: number) => {
  const hash = Math.imul(uid ^ Math.imul(foe, 0x9e3779b1), 0x85ebca6b) >>> 0;
  return STAGGER_MINIMUM + (hash % 1000) / 1000 * STAGGER_SPREAD;
};
