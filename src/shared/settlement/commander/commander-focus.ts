import {
  DANGER_MATRIX, FOCUS_BONUS, FOCUS_RADIUS, HERO_DANGER, PLAYER_DANGER_WEIGHT
} from "../../balance/commander-profiles";
import { probeAccept } from "../faction-vision-probe";
import type { MilitaryTroopType } from "../military-combat-rules";
import type { MilitarySpatialGrid } from "../military-spatial-grid";
import { PLAYER_FACTION } from "../player-fog";
import type { SettlementPoint } from "../settlement-types";
import { rankValueOf, TYPE_VALUE } from "./commander-squads";
import type { CommanderProfile, CommanderUnit } from "./commander-types";

/**
 * Focus fire and dangerous-target priority (A14 plan §3.3). The commander picks one focus per role group
 * among the enemies its faction knows now; every soldier's targeting (both sides) adds the danger matrix,
 * and computer soldiers their focus bonus.
 */

/** The danger (unweighted) of a `target` for an `attacker`; the enemy commander hero is extra dangerous. */
export const dangerOf = (attacker: MilitaryTroopType, target: MilitaryTroopType, hero = false) =>
  DANGER_MATRIX[attacker][target] + (hero ? HERO_DANGER : 0);

/** Lowest health share a focus value divides by (a nearly dead foe is not infinitely attractive). */
const FOCUS_HEALTH_FLOOR = 0.2;

/** How much a group of `attacker` soldiers wants `target` as its focus: dangerous, high ranked and wounded. */
export const focusValue = (attacker: MilitaryTroopType, target: Pick<CommanderUnit, "health" | "rank" | "type">) =>
  (1 + dangerOf(attacker, target.type)) * TYPE_VALUE[target.type] * rankValueOf(target.rank) /
  Math.max(FOCUS_HEALTH_FLOOR, target.health);

/** The weighted bonuses one faction's soldiers score their targets with. */
export interface TargetingWeights {
  danger: number;
  focus: number;
}

const PLAYER_WEIGHTS: Readonly<TargetingWeights> = { danger: PLAYER_DANGER_WEIGHT, focus: 0 };

/**
 * Per faction targeting weights: the player's fixed small danger weight (owner Q5) and no focus; a computer
 * faction's from its commander profile, read once per faction and again after `revision` changed (a script
 * gave a faction another level, or a save was loaded: A14-5).
 */
export const createTargetingWeights = (
  profile: (faction: number) => CommanderProfile, revision: () => number = () => 0
) => {
  const cache = new Map<number, TargetingWeights>();
  let cached = revision();
  return (faction: number): Readonly<TargetingWeights> => {
    if (faction === PLAYER_FACTION) return PLAYER_WEIGHTS;
    if (cached !== revision()) {
      cache.clear();
      cached = revision();
    }
    let weights = cache.get(faction);
    if (weights) return weights;
    const { dangerWeight, focusWeight } = profile(faction);
    weights = { danger: dangerWeight, focus: FOCUS_BONUS * focusWeight };
    cache.set(faction, weights);
    return weights;
  };
};

/**
 * The commander's focus choice for one role group: among enemies the faction knows now (not remembered) within
 * `FOCUS_RADIUS` of the group's centre, the highest `focusValue`; ties keep the lower uid.
 */
export const createFocusChooser = (nearbyUnits: MilitarySpatialGrid<CommanderUnit>) => {
  let attacker: MilitaryTroopType = "shield",
    bestUid = -1,
    bestValue = -Infinity;
  const consider = (unit: CommanderUnit) => {
    const value = focusValue(attacker, unit);
    if (value < bestValue || (value === bestValue && unit.uid > bestUid)) return;
    bestUid = unit.uid;
    bestValue = value;
  };
  return (faction: number, type: MilitaryTroopType, centre: SettlementPoint) => {
    attacker = type;
    bestUid = -1;
    bestValue = -Infinity;
    const isKnownEnemy = probeAccept("commander.focus", faction,
      (unit: CommanderUnit) => unit.faction !== faction && !unit.remembered);
    nearbyUnits.forEachWithin(centre.x, centre.z, FOCUS_RADIUS, isKnownEnemy, consider);
    return bestUid < 0 ? undefined : bestUid;
  };
};
