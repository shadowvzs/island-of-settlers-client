import {
  MORALE_BROKEN, MORALE_CORNERED_RANGE, MORALE_SHAKEN_LEASH, type MoraleState
} from "../balance/morale";
import { CORNERED_UPDATES } from "../balance/retreat-route";
import { DMath } from "../math/deterministic-math";
import type { MilitaryCombatant, MilitaryTroopType } from "./military-combat-rules";
import type { FieldMemory } from "./settlement-combat-core";
import { segmentFraction } from "./settlement-geometry";
import { isGroundSegmentClear } from "./settlement-navigation";
import { nearbyTrafficActors } from "./settlement-person-index";
import { actorSeparation, isTrafficPassThrough } from "./settlement-traffic";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

/**
 * Field stances and target choice of soldiers (docs/archive/dated/battle-ai-plan-2026-10-12.md, Phase 1, and the
 * owner decisions of section 6a). Pure rules: radii in tiles, scores where lower is better.
 *
 * - retreat: an explicit Retreat order ignores everything until it arrives.
 * - move: keeps walking, but strikes back at an attacker in reach, then carries on.
 * - march: attack-move with a destination; diverts to enemies within 6, leashed 8 from the
 *   divert point, then resumes the march.
 * - siege: on the way to (or queued at) an enemy door; fights like a march. Riders of a siege hunt
 *   the enemy's reinforcements (every enemy in the field within 24 tiles) before the door.
 * - seek: attack-move arrived; engages like a guard and seeks the nearest enemy within 24 tiles
 *   once per second (player-ordered units, and computer units that were given an order).
 * - guard: a player unit with no order or after a move; engages near its post, leashed 10.
 * - camp: a computer unit never given an order (camp and fort guards); engages enemies within
 *   10 tiles of its camp and returns there.
 */
export type MilitaryStance = "retreat" | "move" | "march" | "siege" | "seek" | "guard" | "camp";
export type MilitaryOrder = NonNullable<MilitaryCombatant["order"]>;

/** Guard acquisition radius by troop type: archers and riders see further. */
const GUARD_ACQUIRE: Readonly<Record<MilitaryTroopType, number>> = { archer: 9, cavalry: 9, heavy: 7, shield: 7 };
const GUARD_LEASH = 10;
/** Computer camp guards engage within this distance of their camp and return there. */
const CAMP_RADIUS = 10;
const MARCH_ACQUIRE = 6;
const MARCH_LEASH = 8;
/** Attack-move units that have arrived look this far for the nearest enemy. */
export const SEEK_RADIUS = 24;
/** Seconds between two seek scans of one soldier. */
export const SEEK_INTERVAL = 1;
/** Tiles beyond its reach a move-ordered soldier steps to strike back at its attacker. */
export const STRIKE_BACK_SLACK = 1;
/** Idle comrades within this radius of a struck soldier turn on its attacker. */
export const HIT_ALERT_RADIUS = 6;
/** Soldiers re-score their targets staggered over this many ticks. */
const RESCORE_SLOTS = 8;
/** A new target must be this much better (score, about tiles) before a soldier switches. */
const SWITCH_MARGIN = 1.5;
/** Melee soldiers already engaging a target before it counts as over-claimed (foot / rider). */
const CLAIM_CAP_FOOT = 3;
const CLAIM_CAP_RIDER = 2;
const IN_REACH_BONUS = 2;
const ATTACKER_BONUS = 3;
const OVER_CLAIMED_PENALTY = 4;
/** Archers shooting at a target about to fall prefer another one (spread fire). */
const FINISHING_PENALTY = 2;
/** Riders prefer foes they can charge without riding through their own lines (charge lanes). */
const BLOCKED_LANE_PENALTY = 3;
/** An archer advancing on a target stops this far from it, well inside the bow band. */
const ARCHER_ADVANCE_RANGE = 7.5;

export const stanceOf = (state: Pick<MilitaryCombatant, "destination" | "order" | "siege">, computer: boolean)
  : MilitaryStance => {
  if (state.destination && state.order === "retreat") return "retreat";
  if (state.destination && state.order === "move") return "move";
  if (state.destination) return "march";
  if (state.siege !== undefined) return "siege";
  if (state.order === "attackMove") return "seek";
  return computer ? "camp" : "guard";
};

/** How far a soldier in `stance` looks for a new target (0: it never picks one on its own). */
export const acquireRadius = (stance: MilitaryStance, type: MilitaryTroopType) => {
  if (stance === "retreat" || stance === "move") return 0;
  if (stance === "siege" && type === "cavalry") return SEEK_RADIUS;
  if (stance === "march" || stance === "siege") return MARCH_ACQUIRE;
  if (stance === "camp") return CAMP_RADIUS;
  return GUARD_ACQUIRE[type];
};

/** How far from its anchor (guard post, camp or divert point) a soldier may follow a target. */
export const leashRadius = (stance: MilitaryStance, type: MilitaryTroopType) => {
  if (stance === "siege" && type === "cavalry") return Infinity;
  if (stance === "march" || stance === "siege") return MARCH_LEASH;
  if (stance === "camp") return CAMP_RADIUS;
  if (stance === "guard") return GUARD_LEASH;
  return Infinity;
};

/**
 * Morale (A14-2): a shaken or wavering soldier hesitates (no new advance: seek and camp look only as far as a
 * guard, and no long seek scan); a broken one fights only an enemy that corners it.
 */
export const moraleAcquireRadius = (
  radius: number, stance: MilitaryStance, type: MilitaryTroopType, moraleState: MoraleState | undefined
) => {
  if (!moraleState) return radius;
  if (moraleState >= MORALE_BROKEN) return Math.min(radius, MORALE_CORNERED_RANGE);
  return stance === "seek" || stance === "camp" ? Math.min(radius, GUARD_ACQUIRE[type]) : radius;
};

/**
 * A14-3 cornered rule: a routing (broken) soldier whose way out stayed blocked for `CORNERED_UPDATES` morale
 * updates walks on like a `move` order, striking back at an attacker in reach, instead of ignoring every blow.
 */
export const corneredStance = (
  stance: MilitaryStance, memory: Pick<FieldMemory, "blocked" | "moraleState">
): MilitaryStance =>
  stance === "retreat" && memory.moraleState === MORALE_BROKEN && (memory.blocked ?? 0) >= CORNERED_UPDATES
    ? "move" : stance;

/** A shaken or worse soldier follows a target at most `MORALE_SHAKEN_LEASH` tiles from its anchor. */
export const moraleLeash = (leash: number, moraleState: MoraleState | undefined) =>
  moraleState ? Math.min(leash, MORALE_SHAKEN_LEASH) : leash;

/** Stances whose anchor is a fixed post (they walk back there when nothing is left to fight). */
export const returnsToPost = (stance: MilitaryStance) => stance === "guard" || stance === "camp";

export interface TargetCandidate {
  distance: number;
  inReach: boolean;
  attackedMe: boolean;
  /** Melee soldiers of our side already engaging it. */
  claims: number;
  mounted: boolean;
  /** Health share left (0-1). */
  health: number;
  /** A rider's charge at it would ride through its own comrades. */
  laneBlocked?: boolean;
  /** A14-2: the squad focus its commander set (weighted bonus), and its danger for this soldier (weighted). */
  focusBonus?: number;
  danger?: number;
}

/** Melee soldiers already engaging a foe at its claim cap (3 foot / 2 riders). */
export const isOverClaimed = (claims: number, mounted: boolean) =>
  claims >= (mounted ? CLAIM_CAP_RIDER : CLAIM_CAP_FOOT);

/**
 * Lower is better: near and in reach first, the soldier's attacker first, over-claimed targets last. The focus
 * and danger bonuses (A14-2) never apply to an over-claimed melee target, so they cannot break the claim cap of
 * 3 foot / 2 riders per foe; archers have no cap (archer focus is the real focus fire).
 */
export const targetScore = (candidate: TargetCandidate, archer: boolean) => {
  let score = candidate.distance;
  if (candidate.inReach) score -= IN_REACH_BONUS;
  if (candidate.attackedMe) score -= ATTACKER_BONUS;
  const overClaimed = !archer && isOverClaimed(candidate.claims, candidate.mounted);
  if (overClaimed) score += OVER_CLAIMED_PENALTY;
  else score -= (candidate.focusBonus ?? 0) + (candidate.danger ?? 0);
  if (archer && candidate.health < .2 && candidate.claims > 0) score += FINISHING_PENALTY;
  if (candidate.laneBlocked) score += BLOCKED_LANE_PENALTY;
  return score;
};

/** Hysteresis: keep the current target unless the candidate is clearly better. */
export const shouldSwitchTarget = (current: number, candidate: number) => candidate + SWITCH_MARGIN < current;

/** Whether this tick re-scores the soldier's target (staggered by uid, or at once after a hit). */
export const isRescoreTick = (uid: number, tick: number, hit: boolean) =>
  hit || (tick + uid) % RESCORE_SLOTS === 0;

/** Retreat headings tried by a pressed archer, straight away from the enemy first. */
const RETREAT_OFFSETS = [0, .55, -.55, 1.1, -1.1];
const RETREAT_STEP = .7;

/** A retreat must clear the whole step, including mounted bodies and comrades along the way. */
export const isArcherRetreatClear = (
  context: SettlementContext, actor: SettlementActor, point: SettlementPoint
) => {
  if (!isGroundSegmentClear(context, actor, point)) return false;
  const dx = point.x - actor.x, dz = point.z - actor.z;
  return !nearbyTrafficActors(context, actor, RETREAT_STEP + 1.25).some(other => {
    if (other === actor || !other.visible || isTrafficPassThrough(context, actor, other)) return false;
    const fraction = segmentFraction(other.x, other.z, actor.x, actor.z, dx, dz);
    const distance = DMath.hypot(actor.x + fraction * dx - other.x, actor.z + fraction * dz - other.z);
    const initial = DMath.hypot(actor.x - other.x, actor.z - other.z);
    const separation = actorSeparation(actor, other);
    // Already compressed soldiers may escape only by continuously increasing separation.
    if (initial < separation && fraction === 0 &&
      (actor.x - other.x) * dx + (actor.z - other.z) * dz > 0) return false;
    return distance < separation;
  });
};

/**
 * The next retreat point of an archer pressed by `enemy`, or null when no way back is viable
 * (`viable` checks ground and other enemies there).
 */
export const archerRetreatStep = (
  from: SettlementPoint, enemy: SettlementPoint, viable: (point: SettlementPoint) => boolean
) => {
  const angle = DMath.atan2(from.z - enemy.z, from.x - enemy.x);
  for (const offset of RETREAT_OFFSETS) {
    const point = { x: from.x + DMath.cos(angle + offset) * RETREAT_STEP,
      z: from.z + DMath.sin(angle + offset) * RETREAT_STEP };
    if (viable(point)) return point;
  }
  return null;
};

/**
 * Archer retreat (owner 2026-10-15): a pressed archer backs away until no enemy is within
 * `ARCHER_RETREAT_GOAL` tiles, then stops and shoots at full damage. One threat walks at most
 * `ARCHER_RETREAT_BUDGET` tiles back (no endless kiting from a pursuer as fast as the archer); the
 * budget refills after `ARCHER_RETREAT_CALM` seconds with no enemy within point-blank reach.
 */
export const ARCHER_RETREAT_GOAL = 3.5;
export const ARCHER_RETREAT_BUDGET = 8;
export const ARCHER_RETREAT_CALM = 3;

/** One threat episode of an archer: backing away now, tiles walked back, calm seconds since. */
export interface ArcherRetreat { active: boolean; calm: number; walked: number }

/** The enemy search radius of an archer: the retreat goal while backing away, else point-blank. */
export const archerThreatRadius = (retreat: ArcherRetreat | undefined, pointBlankReach: number) =>
  retreat?.active ? ARCHER_RETREAT_GOAL : pointBlankReach;

export const canBackAway = (retreat: ArcherRetreat | undefined) =>
  (retreat?.walked ?? 0) < ARCHER_RETREAT_BUDGET;

/** Records a step back of `walked` tiles; starts the episode on the first one. */
export const recordRetreatStep = (retreat: ArcherRetreat | undefined, walked: number): ArcherRetreat => {
  const episode = retreat ?? { active: true, calm: 0, walked: 0 };
  episode.active = true; episode.calm = 0; episode.walked += walked;
  return episode;
};

/** No enemy pressing the archer: it stops backing away; a long calm ends the episode (undefined). */
export const calmRetreat = (retreat: ArcherRetreat | undefined, dt: number) => {
  if (!retreat) return undefined;
  retreat.active = false; retreat.calm += dt;
  return retreat.calm >= ARCHER_RETREAT_CALM ? undefined : retreat;
};

/** Where an archer stands to shoot `target` from `ARCHER_ADVANCE_RANGE` along their line. */
export const archerAdvancePoint = (from: SettlementPoint, target: SettlementPoint) => {
  const distance = DMath.hypot(from.x - target.x, from.z - target.z) || 1;
  const share = ARCHER_ADVANCE_RANGE / distance;
  return { x: target.x + (from.x - target.x) * share, z: target.z + (from.z - target.z) * share };
};

/** Archers keep this spacing (tiles) along their firing line; this many places are tried each side. */
export const ARCHER_LINE_SPACING = 1;
const ARCHER_LINE_TRIES = 4;
/**
 * The archer's shooting place spread along the front (owner decision 2026-10-15): the advance point,
 * or the nearest place beside it on the same range arc that no other archer of its side holds, so
 * the archers form a line behind the melee instead of a knot. `isFree` checks a place.
 */
export const spreadArcherPoint = (point: SettlementPoint, target: SettlementPoint,
  isFree: (place: SettlementPoint) => boolean) => {
  const dx = point.x - target.x, dz = point.z - target.z, radius = DMath.hypot(dx, dz) || 1;
  const across = { x: -dz / radius, z: dx / radius };
  for (let step = 0; step <= ARCHER_LINE_TRIES * 2; step++) {
    const side = step % 2 ? 1 : -1, offset = Math.ceil(step / 2) * side * ARCHER_LINE_SPACING;
    const shifted = { x: point.x + across.x * offset - target.x, z: point.z + across.z * offset - target.z };
    const length = DMath.hypot(shifted.x, shifted.z) || 1;
    const place = { x: target.x + shifted.x / length * radius, z: target.z + shifted.z / length * radius };
    if (isFree(place)) return place;
  }
  return point;
};
