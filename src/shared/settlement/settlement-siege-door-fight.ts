import { MILITARY_PROFILES } from "../balance/military";
import { DMath } from "../math/deterministic-math";
import { fightingType, type MilitaryTroopType } from "./military-combat-rules";
import { distanceBetween } from "./settlement-geometry";
import type { SettlementSoldier } from "./settlement-military";
import type { SettlementActor, SettlementBuilding } from "./settlement-types";
import type { AuditedRandom } from "./simulation-random";

/** Seconds between blows at the door; a defending archer shoots its bow point-blank at its usual pace. */
const DOOR_BLOW_INTERVAL: Readonly<Record<MilitaryTroopType, number>> = {
  archer: MILITARY_PROFILES.archer.interval, cavalry: 1, heavy: 1.2, shield: 1
};
/** Attacker and defender this close start their duel wherever they stand (the stances are .65 apart). */
const DUEL_CONTACT = .9;

/** Both reached their stances, or they already stand within a blow of each other. */
export const duelReady = (attacker: SettlementActor, defender: SettlementActor) =>
  (attacker.pathIndex >= attacker.path.length && defender.pathIndex >= defender.path.length) ||
  distanceBetween(attacker, defender) <= DUEL_CONTACT;

/** Blows exchanged at a besieged door and the choice of who goes ahead to it. */
export const createSiegeDoorFight = (
  soldiers: Map<number, SettlementSoldier>, actor: (id: number) => SettlementActor | undefined,
  hit: (attacker: SettlementSoldier, defender: SettlementSoldier, full: boolean, pointBlank?: boolean,
    multiplier?: number, archerPost?: boolean) => void,
  random: AuditedRandom
) => {
  const doorDistance = (site: SettlementBuilding, soldier: SettlementSoldier) => {
    const body = actor(soldier.actor);
    return body ? DMath.hypot(body.x - site.access.x, body.z - site.access.z) : Infinity;
  };
  /**
   * The melee soldier in the field nearest the door bashes it. Not the lowest id: a late arrival
   * behind the queue under the walls would wait for ever for the soldiers who wait for it.
   */
  const nearestBasher = (site: SettlementBuilding, waiting: readonly SettlementSoldier[]) => {
    let nearest: SettlementSoldier | undefined, best = Infinity;
    for (const soldier of waiting) {
      if (soldier.combat?.type === "archer" || actor(soldier.actor)?.phase !== "militaryField") continue;
      const distance = doorDistance(site, soldier);
      if (distance < best) { nearest = soldier; best = distance; }
    }
    return nearest;
  };
  /** A finished duel: the survivor lowers its weapon instead of freezing mid-swing. */
  const lowerWeapon = (id: number) => {
    const state = soldiers.get(id)?.combat;
    if (state) { state.attackTime = 0; state.pendingTarget = undefined; }
  };
  const strike = (body: SettlementActor, soldier: SettlementSoldier, opponent: SettlementSoldier, dt: number) => {
    const state = soldier.combat!, other = actor(opponent.actor)!;
    state.cooldown = Math.max(0, state.cooldown - dt);
    const before = state.attackTime ?? 0;
    state.attackTime = Math.max(0, before - dt);
    body.action = "idle"; body.yaw = DMath.atan2(other.x - body.x, other.z - body.z);
    // Only a door defender can be an archer here (attacking archers never duel, defenders queue archers
    // last): the archer left at the door once no other troop type remains shoots point-blank, which the
    // tower archer talent covers too (owner 2026-10-20).
    if (before > .15 && state.attackTime <= .15)
      hit(soldier, opponent, random.at("siege.doorContact", soldier.actor)() < .7 + soldier.rank * .1, fightingType(state) === "archer", 1, fightingType(state) === "archer");
    if (!state.cooldown && soldiers.has(opponent.actor)) {
      state.cooldown = DOOR_BLOW_INTERVAL[fightingType(state)];
      state.attackTime = .6; body.animationTime = 0;
    }
  };
  return { doorDistance, lowerWeapon, nearestBasher, strike };
};
