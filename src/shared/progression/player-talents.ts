import { levelForExperience, TALENT_RESET_GEMS } from "@shared/catalog/balance";

import type { PlayerProgress } from "./player-progress";
import {
  compactTalentRanks, keepsAppliedRanks, spentTalentPoints, type TalentRanks,
talentRanksError} from "./talents";

export type TalentCommandResult = { ok: true; progress: PlayerProgress } | { ok: false; reason: string };

/**
 * Apply: the pending tree becomes the applied one. It may only add points to the applied ranks and
 * must pass every rule at the current level (points, level gates, capstone gates); `level` is the level the
 * island plays with when its rules fix or cap it (plan §9.1).
 */
export const applyTalents = (
  progress: PlayerProgress, next: unknown, level = levelForExperience(progress.experience)
): TalentCommandResult => {
  const error = talentRanksError(next, level);
  if (error) return { ok: false, reason: error };
  const ranks = compactTalentRanks(next as TalentRanks), applied = progress.talents;
  if (!keepsAppliedRanks(applied, ranks)) return { ok: false, reason: "Applied talents can only be reset" };
  if (spentTalentPoints(ranks) === spentTalentPoints(applied)) return { ok: false, reason: "No new talent points to apply" };
  return { ok: true, progress: { ...progress, talents: ranks } };
};

/** Reset after Apply: every applied point comes back for TALENT_RESET_GEMS gems. */
export const resetAppliedTalents = (progress: PlayerProgress): TalentCommandResult => {
  if (!spentTalentPoints(progress.talents)) return { ok: false, reason: "No applied talents to reset" };
  if (progress.gems < TALENT_RESET_GEMS) return { ok: false, reason: `Resetting talents costs ${TALENT_RESET_GEMS} gems` };
  return { ok: true, progress: { ...progress, gems: progress.gems - TALENT_RESET_GEMS, talents: {} } };
};
