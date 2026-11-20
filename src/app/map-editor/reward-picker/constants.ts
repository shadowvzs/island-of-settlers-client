import { CAMPAIGN_LIMITS } from "../../../../../island-of-settlers-shared/src/campaign/campaign-constants";

/**
 * Tabs of the reward picker. The Actor editor will add tabs (buildings, ships) here and in `catalog.ts`; callers
 * choose which tabs are offered and in which order through the `tabs` prop.
 */
export const REWARD_PICKER_TAB_IDS = ["wares", "people", "decorations", "misc"] as const;
export type RewardPickerTab = (typeof REWARD_PICKER_TAB_IDS)[number];

/** Every tab, in the owner's order (2026-11-11). */
export const DEFAULT_REWARD_PICKER_TABS: readonly RewardPickerTab[] = REWARD_PICKER_TAB_IDS;

/** Selected amounts are whole numbers in 1..max (settlers use the count limit, the rest the amount limit). */
export const MIN_REWARD_AMOUNT = 1;
export const MAX_REWARD_AMOUNT = CAMPAIGN_LIMITS.maxAmount;
export const MAX_SETTLER_REWARD = CAMPAIGN_LIMITS.maxCount;

/** Soldier ranks offered for each troop type (0-based, matching the rank portraits). */
export const REWARD_SOLDIER_RANKS = Array.from({ length: CAMPAIGN_LIMITS.maxSoldierRank + 1 }, (_, rank) => rank);

/** The ware id of coins: they are offered in Misc, not among the wares. */
export const COIN_WARE_ID = "coins";

/** Currency rewards share one compact row of the selected list, in this order (owner 2026-11-11). */
export const CURRENCY_REWARD_KINDS = ["coins", "xp", "gems"] as const;
