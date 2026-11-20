import { MILITARY_PROFILES } from "../balance/military";
import { DMath } from "../math/deterministic-math";
import { probeAccept } from "./faction-vision-probe";
import { fightingType, type MilitaryCombatant } from "./military-combat-rules";
import { footworkDistance } from "./military-engagement";
import type { MeleeApproach } from "./military-melee";
import {
  ARCHER_LINE_SPACING, archerAdvancePoint, archerRetreatStep, archerThreatRadius, calmRetreat, canBackAway,
  isArcherRetreatClear, type MilitaryStance, recordRetreatStep, spreadArcherPoint
} from "./military-targeting";
import { nationArcherRangeFactor } from "./nation-bonuses";
import {
  type CombatCore, type FieldMemory, type FieldTarget, POINT_BLANK_REACH, profileOf
} from "./settlement-combat-core";
import type { CombatRouting } from "./settlement-combat-routing";
import { reachOf } from "./settlement-combat-targeting";
import { turnYawToward } from "./settlement-geometry";
import { isNavigationClear } from "./settlement-navigation";
import { setActorPath } from "./settlement-paths";
import type { SettlementActor, SettlementPoint } from "./settlement-types";

/** A retreating archer's next step keeps this clear of other soldiers and of further enemies. */
const RETREAT_ENEMY_CLEARANCE = 1.5;
/** Comrades swinging within this distance (tiles) stagger a soldier's first blow. */
const STAGGER_NEIGHBOURHOOD = 3;
/** A blow or a draw starts only within this angle (radians) of the foe; the body turns there first. */
const AIM_TOLERANCE = .35;
/** Turning pace of a soldier facing its foe while it waits or steps (radians per second). */
const FACING_RATE = 9;
/** Footwork closer than this (tiles) to the wanted distance stands still. */
const FOOTWORK_TOLERANCE = .06;
/** A soldier waiting in the ring stands once this close (tiles) to its spot. */
const RING_ARRIVAL = .4;
/** Inside the ring a waiting soldier stands still once this far (tiles) beyond its reach. */
const RING_REACH_MARGIN = .25;

/** Facing `point` closely enough to swing or loose at it. */
const isFacing = (actor: SettlementActor, point: SettlementPoint) => {
  const heading = DMath.atan2(point.x - actor.x, point.z - actor.z);
  return Math.abs(DMath.atan2(DMath.sin(heading - actor.yaw), DMath.cos(heading - actor.yaw))) <= AIM_TOLERANCE;
};
/** Turns towards `point` at a soldier's turning pace (no snapping round while it waits or steps). */
const faceTowards = (actor: SettlementActor, point: SettlementPoint, dt: number) => {
  const heading = DMath.atan2(point.x - actor.x, point.z - actor.z);
  actor.yaw = turnYawToward(actor.yaw, heading, FACING_RATE * dt);
};
/**
 * A soldier without a place waits at its ring spot, or where it stands when it is already inside
 * the ring but out of reach: walking back out to the ring was most of the field's about-faces.
 */
const waitsInRing = (actor: SettlementActor, place: MeleeApproach, distance: number, reach: number) =>
  DMath.hypot(place.point.x - actor.x, place.point.z - actor.z) <= RING_ARRIVAL ||
  (distance > reach + RING_REACH_MARGIN && distance <= place.standoff);

/** A soldier fighting its chosen foe: blows, footwork, the ring, and archers keeping their range. */
export const createCombatEngagement = ({
  context, factionOf, grid, inField, isKnownEnemyOf, melee, soldiers
}: CombatCore, { chase, move, stand, walk }: CombatRouting) => {
  /** Starts a blow or a draw at `target` (damage lands when the swing or draw completes). */
  const strikeAt = (actor: SettlementActor, state: MilitaryCombatant, target: SettlementActor, interval: number,
    dt: number) => {
    stand(actor);
    // It turns to its foe between blows or volleys and only swings or draws once it faces it.
    faceTowards(actor, target, dt);
    if (state.cooldown || !isFacing(actor, target)) return;
    actor.yaw = DMath.atan2(target.x - actor.x, target.z - actor.z);
    state.cooldown = interval; state.attackTime = .6; actor.animationTime = 0;
    state.pendingTarget = target.uid;
  };
  /** A comrade close by is already swinging or drawing (then first blows are staggered). */
  const fightsBeside = (actor: SettlementActor, state: MilitaryCombatant) =>
    grid.anyWithin(actor.x, actor.z, STAGGER_NEIGHBOURHOOD, body => body !== actor &&
      factionOf(body.uid) === state.faction && (soldiers.get(body.uid)?.combat?.attackTime ?? 0) > 0);
  /**
   * In reach of its foe: blows on the cooldown (the first one at a new foe staggered), and between
   * blows a little footwork on foot, a step back after the blow and in again before the next.
   */
  const duel = (actor: SettlementActor, state: MilitaryCombatant, foe: SettlementActor, place: MeleeApproach,
    reach: number, dt: number) => {
    const { interval } = profileOf(state);
    state.cooldown = Math.max(state.cooldown,
      melee.firstBlowDelay(actor.uid, foe.uid, interval, fightsBeside(actor, state)));
    if (!state.cooldown || actor.mounted) { strikeAt(actor, state, foe, interval, dt); return; }
    const distance = DMath.hypot(foe.x - actor.x, foe.z - actor.z) || 1;
    const wanted = footworkDistance(place.standoff, reach, state.cooldown, interval);
    if (Math.abs(distance - wanted) <= FOOTWORK_TOLERANCE) { stand(actor); faceTowards(actor, foe, dt); return; }
    const share = wanted / distance;
    actor.path = [{ x: foe.x + (actor.x - foe.x) * share, z: foe.z + (actor.z - foe.z) * share }];
    actor.pathIndex = 0;
    move(actor, dt);
    faceTowards(actor, foe, dt);
  };
  /** An archer's shooting place, beside the places its comrades already hold (a line, not a knot). */
  const archerPlace = (actor: SettlementActor, state: MilitaryCombatant, target: SettlementActor) =>
    spreadArcherPoint(archerAdvancePoint(actor, target), target, place => isNavigationClear(context, place) &&
      !grid.anyWithin(place.x, place.z, ARCHER_LINE_SPACING * .9, body => body !== actor && inField(body) &&
        Boolean(soldiers.get(body.uid)?.combat) && fightingType(soldiers.get(body.uid)!.combat!) === "archer" && factionOf(body.uid) === state.faction));
  /** Fights `target`: strikes in reach, otherwise closes in (archers: into the bow band). */
  const engage = (actor: SettlementActor, state: MilitaryCombatant, stance: MilitaryStance,
    target: FieldTarget, dt: number) => {
    const profile = profileOf(state);
    const distance = DMath.hypot(target.body.x - actor.x, target.body.z - actor.z);
    const rangeFactor = fightingType(state) === "archer" && state.faction === 0
      ? nationArcherRangeFactor(context.playerNation) : 1;
    const reach = reachOf(actor, state, target, rangeFactor);
    if (fightingType(state) === "archer") {
      if (distance >= profile.minimumRange && distance <= reach) {
        state.cooldown = Math.max(state.cooldown,
          melee.firstBlowDelay(actor.uid, target.body.uid, profile.interval, fightsBeside(actor, state)));
        strikeAt(actor, state, target.body, profile.interval, dt); return true;
      }
      if (stance === "move") return false;
      chase(actor, state, archerPlace(actor, state, target.body)); walk(actor, dt);
      return true;
    }
    const place = melee.approach(actor, state, target.body);
    // Only the foe's place holders fight it (and whoever it fights); the others keep to the ring.
    if (distance <= reach && place.admitted) { duel(actor, state, target.body, place, reach, dt); return true; }
    // Waiting in the ring: it stands just out of reach, facing the fight, until a place frees.
    if (!place.admitted && waitsInRing(actor, place, distance, reach)) {
      stand(actor); faceTowards(actor, target.body, dt); return true;
    }
    chase(actor, state, place.point);
    walk(actor, dt);
    return true;
  };
  /** One step straight (or slanted) away from `nearest`; the tiles walked, 0 when no way back is viable. */
  const backAway = (actor: SettlementActor, state: MilitaryCombatant, nearest: SettlementActor, dt: number) => {
    const enemy = isKnownEnemyOf(state.faction);
    const step = archerRetreatStep(actor, nearest, point => isArcherRetreatClear(context, actor, point) &&
      !grid.anyWithin(point.x, point.z, RETREAT_ENEMY_CLEARANCE, probeAccept("archer.retreatClearance",
        state.faction, body => body !== nearest && enemy(body))));
    if (!step) return 0;
    const previous = { x: actor.x, z: actor.z };
    setActorPath(actor, [step], "militaryField"); move(actor, dt);
    return DMath.hypot(actor.x - previous.x, actor.z - previous.z);
  };
  /**
   * An archer with an enemy inside its minimum range backs away until it has room
   * (`ARCHER_RETREAT_GOAL`), then stops and shoots at full damage (owner 2026-10-15). Only cornered
   * (no viable way back, or the threat's retreat budget spent) does it shoot point-blank at half damage.
   */
  const pressArcher = (actor: SettlementActor, state: MilitaryCombatant, memory: FieldMemory, dt: number) => {
    const enemy = isKnownEnemyOf(state.faction);
    const radius = archerThreatRadius(memory.retreat, POINT_BLANK_REACH);
    const nearest = grid.nearest(actor.x, actor.z, radius, probeAccept("archer.threat", state.faction,
      body => inField(body) && enemy(body)));
    if (!nearest) { memory.retreat = calmRetreat(memory.retreat, dt); state.closeQuarters = undefined; return false; }
    // An archer fallen from its scaffold lands among the attackers and fights them where it stands.
    const walked = !state.fallenTowerArcher && canBackAway(memory.retreat) ? backAway(actor, state, nearest, dt) : 0;
    if (walked > 1e-8) {
      memory.retreat = recordRetreatStep(memory.retreat, walked); state.closeQuarters = undefined;
      return true;
    }
    if (memory.retreat) { memory.retreat.active = false; memory.retreat.calm = 0; }
    // Out of point-blank reach the bow shoots at full damage from where the archer stands.
    if (DMath.hypot(nearest.x - actor.x, nearest.z - actor.z) > POINT_BLANK_REACH) {
      state.closeQuarters = undefined; return false;
    }
    state.closeQuarters = true; state.target = nearest.uid;
    strikeAt(actor, state, nearest, MILITARY_PROFILES.archer.interval, dt);
    return true;
  };
  return { backAway, engage, pressArcher,
    /** Manual control uses the same first-blow staggering, facing gate and attack timer. */
    beginStrike: (actor: SettlementActor, state: MilitaryCombatant, target: SettlementActor, dt: number) => {
      const { interval } = profileOf(state);
      state.cooldown = Math.max(state.cooldown,
        melee.firstBlowDelay(actor.uid, target.uid, interval, fightsBeside(actor, state)));
      strikeAt(actor, state, target, interval, dt);
    }
  };
};
