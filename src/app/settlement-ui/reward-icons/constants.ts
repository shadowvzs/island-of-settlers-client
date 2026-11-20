import type { RewardEntryKind } from "./entries";

/** The ware id of gold coins in goods records; it becomes the `coins` reward kind. */
export const COIN_WARE = "coins";

/** At most this many icons per display; a longer list ends with a "+N more" chip in the last slot. */
export const DEFAULT_MAX_REWARD_ICONS = 8;

/** Soldier portraits, troop names and building names without a known player nation. */
export const DEFAULT_REWARD_NATION = "roman";

/** Display order: coins, gems, goods, units, unlocks, then decorations grouped at the end; unknown kinds last. */
export const REWARD_KIND_ORDER: Readonly<Record<RewardEntryKind, number>> = {
  buildingUnlock: 5, coins: 0, decoration: 6, gems: 1, settlers: 4, soldier: 3, ware: 2, xp: -1
};
export const UNKNOWN_REWARD_ORDER = 7;

/** The lowest soldier rank (0-based): the recruit a Tavern trains; a soldier line without a rank is one too. */
export const RECRUIT_SOLDIER_RANK = 0;
