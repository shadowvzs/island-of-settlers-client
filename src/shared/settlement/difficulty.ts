import { DIFFICULTY_PROFILES, type DifficultyProfile, ENEMY_DIFFICULTY_SCALING } from "../balance/enemy-scaling";
import { MAX_SOLDIER_RANK } from "./settlement-military-ranks";

/**
 * Difficulty multiplier for non-campaign play (owner decision 2026-11-08). It scales only numbers the
 * computer/enemy side already owns; the player's own numbers never change. Normal is the default and an
 * exact no-op, and the level is not selectable yet: this module is the infrastructure for that choice.
 * The numbers live in the enemy scaling table (`balance/enemy-scaling.ts`).
 */
export const DIFFICULTY_LEVELS = ["normal", "hard", "veryHard"] as const;
export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];

export const isDifficultyLevel = (value: unknown): value is DifficultyLevel =>
  typeof value === "string" && (DIFFICULTY_LEVELS as readonly string[]).includes(value);

/** The single level-to-profile lookup; Normal is the fallback for an unknown saved value. */
export const difficultyProfile = (level: DifficultyLevel): DifficultyProfile =>
  DIFFICULTY_PROFILES[level] ?? DIFFICULTY_PROFILES.normal;

/**
 * An existing computer-side amount at `level`. Normal returns the amount untouched (no rounding), so a
 * normal game stays byte-identical; other levels round the product deterministically.
 */
export const difficultyScaled = (
  value: number, field: keyof DifficultyProfile, level: DifficultyLevel = "normal"
): number => {
  if (level === "normal") return value;
  return Math.round(value * difficultyProfile(level)[field]);
};

const scalingOf = (level: DifficultyLevel) => ENEMY_DIFFICULTY_SCALING[level] ?? ENEMY_DIFFICULTY_SCALING.normal;

/** A computer-side soldier's rank at `level`: the table's tier bonus, never above the top rank; Normal untouched. */
export const difficultyRank = (rank: number, level: DifficultyLevel = "normal") => {
  if (level === "normal") return rank;
  return Math.max(rank, Math.min(MAX_SOLDIER_RANK, rank + scalingOf(level).rankBonus));
};

/** Extra archer towers beside the colony forts and the adventure camps at `level` (0 at Normal). */
export const difficultyArcherTowers = (level: DifficultyLevel = "normal") => scalingOf(level).archerTowers;
