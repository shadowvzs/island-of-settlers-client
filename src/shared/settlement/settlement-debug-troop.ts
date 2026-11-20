import { militaryHealth, type MilitaryTroopType } from "./military-combat-rules";
import { findHomeBuilding } from "./settlement-home";
import type { createSettlementMilitary } from "./settlement-military";
import { MAX_SOLDIER_RANK } from "./settlement-military-ranks";
import type { SettlementContext, SettlementPoint } from "./settlement-types";
import { isTavernTroop, TAVERN_TROOPS } from "./tavern-rules";

type Military = Pick<ReturnType<typeof createSettlementMilitary>, "combat" | "storeReturnedTroops">;

export interface DebugTroopChoice {
  rank: number;
  type: MilitaryTroopType;
}

export interface DebugTroopGrant extends DebugTroopChoice {
  /** The new soldier's actor uid. */
  id: number;
}

export interface DebugSoldierSpawn extends DebugTroopChoice {
  /** The new field soldier's actor uid. */
  id: number;
}

/** A random troop type the player can recruit (every nation fields the tavern troops) and rank. */
export const randomDebugTroop = (random: () => number): DebugTroopChoice => ({
  rank: Math.floor(random() * (MAX_SOLDIER_RANK + 1)),
  type: TAVERN_TROOPS[Math.floor(random() * TAVERN_TROOPS.length)]!
});

const validChoice = ({ rank, type }: DebugTroopChoice) =>
  isTavernTroop(type) && Number.isSafeInteger(rank) && rank >= 0 && rank <= MAX_SOLDIER_RANK;

/** Development tool "Spawn soldier on click": one full-health ordinary field soldier at the click. */
export const spawnDebugSoldier = (
  military: Military, point: SettlementPoint, choice: DebugTroopChoice
): DebugSoldierSpawn | null => {
  if (!validChoice(choice)) return null;
  const id = military.combat.spawnPlayer(point, choice.type, choice.rank);
  if (id === null) return null;
  military.combat.admitPlayer(id);
  return { ...choice, id };
};

/**
 * Development tool "Add a random military unit": one full-health soldier stored as a reserve in the
 * home building (headquarters, or a colony's harbour), through the same path as troops landing there.
 */
export const grantDebugTroop = (
  context: SettlementContext, military: Military, choice: DebugTroopChoice
): DebugTroopGrant | null => {
  const home = findHomeBuilding(context);
  if (!home || !validChoice(choice)) return null;
  const { rank, type } = choice;
  const [soldier] = military.storeReturnedTroops([{ hp: militaryHealth(type, rank), rank, type }], home);
  return { id: soldier!.uid, rank, type };
};
