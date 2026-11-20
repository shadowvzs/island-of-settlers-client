import { buildingRules, buildingsWithRules } from "@shared/catalog/building-data/rules";

/** The player level that unlocks a building type (rules sidecar `unlockLevel`); 1 for types without rules. */
export const buildingUnlockLevel = (typeId: number) => buildingRules(typeId)?.unlockLevel ?? 1;

/** Without a player level (tools, tests, unlock-all scenarios) every building is unlocked. */
export const isBuildingUnlocked = (typeId: number, playerLevel?: number) =>
  playerLevel === undefined || playerLevel >= buildingUnlockLevel(typeId);

const unlockedAt = new Map<number, readonly number[]>();
for (const { entry, rules } of buildingsWithRules())
  unlockedAt.set(rules.unlockLevel, [...unlockedAt.get(rules.unlockLevel) ?? [], entry.code]);

/** Building types that unlock exactly at this level, by type id (level 1: the starting set). */
export const buildingsUnlockedAt = (level: number): readonly number[] => unlockedAt.get(level) ?? [];

/** The refusal shown when the player's level is too low for a building. */
export const buildingLockReason = (typeId: number) => `Reach level ${buildingUnlockLevel(typeId)} to build this`;
