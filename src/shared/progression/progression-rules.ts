import {
  type EffectiveRules, resolveEffectiveLevel
} from "../../../../island-of-settlers-shared/src/game-settings/effective-rules";
import type { LevelRule } from "../../../../island-of-settlers-shared/src/game-settings/game-settings";
import type { PlayerProgress } from "./player-progress";

/**
 * Progression under the rules of the island on screen (plan §9, lane PROG): what the player session may grant and
 * what the progression UI shows. Every reader takes the island's `effectiveGameRules()`, the rules the simulation
 * runs with, so UI, session and simulation cannot disagree (owner Q10). Absent rules = today's game.
 */
export type ProgressionRules = Pick<EffectiveRules, "experience" | "level" | "rewards" | "talents">;

/** Refusal of the talent commands while the rules switch talents off. */
export const TALENTS_OFF = "Talents are switched off in this game";

export const experienceEnabled = (rules: ProgressionRules | undefined) => rules?.experience ?? true;
export const rewardsEnabled = (rules: ProgressionRules | undefined) => rules?.rewards ?? true;
export const talentsEnabled = (rules: ProgressionRules | undefined) => rules?.talents ?? true;
/** Levels are earned from experience (no fixed or capped level on this island). */
export const levelsEarned = (rules: ProgressionRules | undefined) => (rules?.level.kind ?? "earned") === "earned";

/** The level the island plays with: the account level unless the rules fix or cap it. */
export const effectivePlayerLevel = (rules: ProgressionRules | undefined, accountLevel: number) =>
  rules ? resolveEffectiveLevel(rules.level, accountLevel) : accountLevel;

interface ExperienceResult {
  levelUps: readonly unknown[];
  progress: PlayerProgress;
}
type ProgressBefore = Pick<PlayerProgress, "experience" | "gems">;

/** A grant's other changes (a finished quest) without its experience, level-ups and their gems. */
export const withoutExperience = <Result extends ExperienceResult>(result: Result, before: ProgressBefore): Result =>
  ({ ...result, levelUps: [], progress: { ...result.progress, experience: before.experience, gems: before.gems } });

/** An experience grant under the rules: with experience off it adds none (plan §9.2). */
export const experienceResultUnderRules = <Result extends ExperienceResult>(
  rules: ProgressionRules | undefined, result: Result, before: ProgressBefore
): Result => (experienceEnabled(rules) ? result : withoutExperience(result, before));

/** What the player corner shows of the progression (plan §9.4, owner Q10). */
export interface ProgressionVisibility {
  /** Reward displays name experience (off with `experience` off: none is paid). */
  experienceRewarded: boolean;
  experienceShown: boolean;
  /** A map fixes or caps the level: the number carries a small lock. */
  levelLocked: boolean;
  levelShown: boolean;
  /** Quest and campaign reward displays (off with `rewards` off: nothing is paid, plan §9.3). */
  rewardsShown: boolean;
  talentsShown: boolean;
}

export const FULL_PROGRESSION: ProgressionVisibility = Object.freeze({
  experienceRewarded: true, experienceShown: true, levelLocked: false, levelShown: true, rewardsShown: true,
  talentsShown: true
});

/**
 * The §9.4 table. `settingsLevel` is the level rule of the game settings (the pinned rules): a level they fix
 * hides the badge (progression is off), a level only the map fixes or caps shows the number with a lock.
 */
export const progressionVisibility = (
  rules: ProgressionRules | undefined, settingsLevel: LevelRule["kind"] = "earned"
): ProgressionVisibility => {
  if (!rules) return FULL_PROGRESSION;
  const earned = levelsEarned(rules), fixedBySettings = settingsLevel === "fixed";
  return {
    experienceRewarded: rules.experience,
    experienceShown: earned && rules.experience,
    levelLocked: !earned && !fixedBySettings,
    levelShown: !fixedBySettings,
    rewardsShown: rules.rewards,
    talentsShown: rules.talents
  };
};
