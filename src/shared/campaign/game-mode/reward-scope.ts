import {
  type GameSettings, hasHomeIsland, rewardsEnabled
} from "../../../../../island-of-settlers-shared/src/game-settings/game-settings";
import { WALLET_REWARD_KINDS } from "./constants";

/**
 * What rewards a deployment pays (plan §9.3, owner Q2/Q8): `all` with a home island, `wallet` (gems and XP only)
 * when the admin switches rewards on without a home, `none` when rewards are off. The editors show reward fields
 * by this scope and keep the stored values of what they hide.
 */
export type RewardScope = "all" | "none" | "wallet";

export const rewardScopeOf = (settings: GameSettings): RewardScope => {
  if (!rewardsEnabled(settings)) return "none";
  return hasHomeIsland(settings) ? "all" : "wallet";
};

/** True when a reward line of `kind` is paid (and therefore edited) under `scope`. */
export const isRewardKindPaid = (scope: RewardScope, kind: string) =>
  scope === "all" || (scope === "wallet" && WALLET_REWARD_KINDS.has(kind));
