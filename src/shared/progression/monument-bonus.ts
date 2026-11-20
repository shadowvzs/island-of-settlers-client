import { MONUMENT_EXPERIENCE_BONUS_PERCENT } from "@shared/catalog/balance";

import { BuildingType } from "../settlement/building-type-ids";
import { isOwnBuilding } from "../settlement/settlement-home";
import { PERCENT } from "./constants";

/** The building fields the Monument check reads. */
type MonumentCandidate = { construction: number; militaryFaction?: number; typeId: number; uid: number };

/**
 * A completed player Monument among the home island's buildings; `exceptUid` leaves one out (the
 * Monument whose own completion is being rewarded, so its completion experience earns no bonus).
 */
export const hasCompletedMonument = (buildings: readonly MonumentCandidate[], exceptUid?: number) =>
  buildings.some(building => building.typeId === BuildingType.Monument && building.construction >= 1 &&
    isOwnBuilding(building) && building.uid !== exceptUid);

/**
 * One experience gain with the Monument bonus: the gain is rounded to a whole non-negative number first
 * (as `awardExperience` does), then +25 % rounded down (a 3 XP gain earns none, 4 XP earns 1).
 */
export const monumentExperience = (experience: number, active: boolean) => {
  const base = Math.max(0, Math.round(experience));
  if (!active) return base;
  return base + Math.floor(base * MONUMENT_EXPERIENCE_BONUS_PERCENT / PERCENT);
};

/** The player's Monument bonus is active (a completed Monument on the home island). */
export const hasMonumentBonus = (progress: { homeMonument?: true } | undefined) => progress?.homeMonument === true;

/** Progress with the home Monument flag set to `completed`; the same object when it is unchanged. */
export const withHomeMonument = <Progress extends { homeMonument?: true }>(progress: Progress, completed: boolean) => {
  if (hasMonumentBonus(progress) === completed) return progress;
  if (completed) return { ...progress, homeMonument: true as const };
  const { homeMonument: _removed, ...rest } = progress;
  return rest as Progress;
};
