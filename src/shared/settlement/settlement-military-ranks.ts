/** Persisted military rank scheme; absence means the historical five-rank scheme. */
export const MILITARY_RANK_VERSION = 1;
export const MAX_SOLDIER_RANK = 2;
export const LEGACY_MAX_SOLDIER_RANK = 4;

const ARMOUR_RANKS = ["recruit", "soldier", "centurion"] as const;

export const militaryArmourRank = (rank: number) => ARMOUR_RANKS[rank] ?? "recruit";

/** Called only after the save's original rank bounds and references have been validated. */
export const migrateLegacyMilitaryRank = (rank: number) => {
  if (rank === 0) return 0;
  if (rank <= 2) return 1;
  return 2;
};
