import {
  ARMY_REQUEST_PRIORITIES, ARMY_REQUEST_SOLDIERS, COUNTER_ENEMIES_PER_SOLDIER, COUNTER_MIN_KNOWN,
  COUNTER_SHARE_PERCENT
} from "../../balance/commander-director";
import { DANGER_MATRIX } from "../../balance/commander-profiles";
import {
  MILITARY_TROOP_TYPES, type MilitaryTroopType, ORDINARY_TROOP_TYPES, type OrdinaryTroopType
} from "../military-combat-rules";
import type { CommanderUnit } from "./commander-types";
import { REFERENCE_SOLDIER } from "./known-sites";
import type { ArmyRequest, ArmyRequestReason } from "./strategic-intents";

/**
 * Army requests (A14 plan §5.4, lane A14-4c): what a faction's army wants built, from its intents' strength
 * shortfall, the enemy types it KNOWS (seen now or remembered; never the true enemy army) and its forces'
 * losses. Pure and integer: counts are whole soldiers, at most `ARMY_REQUEST_SOLDIERS` in the whole list.
 */
export interface ArmyRequestInputs {
  faction: number;
  /** The faction's perception (own soldiers, enemies known now, remembered enemies). */
  perception: readonly CommanderUnit[];
  /** Strength points its attack intents still lack (Σ minStrength − committed, never negative). */
  shortfall: number;
  /** Strength points its intent forces lost since they formed. */
  lost: number;
}

/** The soldier that screens a counter group and fills an untyped request: the swordsman. */
const SCREEN_TYPE: OrdinaryTroopType = "shield";
const PERCENT = 100;

/** The foot type that prefers `enemy` as its target most (the shared danger matrix), the earlier type on ties. */
const counterOf = (enemy: MilitaryTroopType) => {
  let best = ORDINARY_TROOP_TYPES[0]!;
  for (const type of ORDINARY_TROOP_TYPES)
    if (DANGER_MATRIX[type][enemy] > DANGER_MATRIX[best][enemy]) best = type;
  return best;
};

/** Known riders → archers (+ swordsmen), archers → swordsmen, axemen → archers, swordsmen → axemen. */
export const COUNTER_TYPES: Readonly<Record<MilitaryTroopType, OrdinaryTroopType>> = Object.freeze({
  archer: counterOf("archer"), cavalry: counterOf("cavalry"), heavy: counterOf("heavy"), shield: counterOf("shield")
});

export interface KnownEnemyType { type: MilitaryTroopType; count: number }

/**
 * The enemy type the faction knows most of, once it knows at least `COUNTER_MIN_KNOWN` of them and they are
 * `COUNTER_SHARE_PERCENT` of its known enemies (ties: the earlier troop type).
 */
const dominantKnownEnemy = (faction: number, perception: readonly CommanderUnit[]) => {
  const counts: Record<MilitaryTroopType, number> = { archer: 0, cavalry: 0, heavy: 0, shield: 0 };
  let known = 0;
  for (const unit of perception) {
    if (unit.faction === faction) continue;
    counts[unit.type]++;
    known++;
  }
  let best: KnownEnemyType | undefined;
  for (const type of MILITARY_TROOP_TYPES)
    if (counts[type] > (best?.count ?? 0)) best = { count: counts[type], type };
  if (!best || best.count < COUNTER_MIN_KNOWN || best.count * PERCENT < known * COUNTER_SHARE_PERCENT)
    return undefined;
  return best;
};

/** The faction's request list, most urgent first: intent shortfall, counter-composition, loss replacement. */
export const armyRequestsOf = ({ faction, lost, perception, shortfall }: ArmyRequestInputs): ArmyRequest[] => {
  const requests: ArmyRequest[] = [];
  let room = ARMY_REQUEST_SOLDIERS;
  const add = (type: OrdinaryTroopType, wanted: number, reason: ArmyRequestReason) => {
    const count = Math.min(wanted, room);
    if (count <= 0) return;
    room -= count;
    requests.push({ count, priority: ARMY_REQUEST_PRIORITIES[reason], reason, type });
  };
  const dominant = dominantKnownEnemy(faction, perception);
  const counter = dominant ? COUNTER_TYPES[dominant.type] : SCREEN_TYPE;
  add(counter, Math.ceil(shortfall / REFERENCE_SOLDIER), "intentShortfall");
  if (dominant) {
    const each = Math.ceil(dominant.count / COUNTER_ENEMIES_PER_SOLDIER);
    add(counter, each, "counterComposition");
    if (counter !== SCREEN_TYPE) add(SCREEN_TYPE, each, "counterComposition");
  }
  add(SCREEN_TYPE, Math.floor(lost / REFERENCE_SOLDIER), "lossReplacement");
  return requests;
};
