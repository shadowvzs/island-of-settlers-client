import { isOrdinaryTroopType, militaryHealth, type MilitaryTroopType } from "../settlement/military-combat-rules";
import { isSaveObject } from "../settlement/save-validation";
import type { EmigratedTroop } from "../settlement/settlement-military";
import { START_TROOP_LIMITS } from "./constants";

/**
 * One line of a map file's start soldiers (plan §5.3, §11.1): player soldiers waiting in the home building's
 * reserve before the first tick. Ordinary troop types only (retired cavalry is refused like authored units).
 */
export interface ScenarioStartTroop {
  count: number;
  rank: number;
  type: MilitaryTroopType;
}

const wholeIn = (value: unknown, min: number, max: number) =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;

const isStartTroop = (value: unknown): value is ScenarioStartTroop => isSaveObject(value) &&
  isOrdinaryTroopType(value.type) && wholeIn(value.rank, 0, START_TROOP_LIMITS.maxRank) &&
  wholeIn(value.count, 1, START_TROOP_LIMITS.total);

/** Absent, or at most `lines` valid lines with at most `total` soldiers together. */
export const validScenarioStartTroops = (value: unknown) => {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > START_TROOP_LIMITS.lines || !value.every(isStartTroop)) return false;
  return startTroopTotal(value) <= START_TROOP_LIMITS.total;
};

export const startTroopTotal = (troops: readonly ScenarioStartTroop[]) =>
  troops.reduce((sum, line) => sum + line.count, 0);

/** The start soldiers as full-health recruits of their rank, in line order (deterministic). */
export const startTroopRecruits = (troops: readonly ScenarioStartTroop[] | undefined): EmigratedTroop[] =>
  (troops ?? []).flatMap(({ count, rank, type }) =>
    Array.from({ length: count }, () => ({ hp: militaryHealth(type, rank), rank, type })));
