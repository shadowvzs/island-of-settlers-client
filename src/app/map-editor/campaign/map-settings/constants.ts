import { isRewardKindPaid } from "../../../../shared/campaign/game-mode/reward-scope";
import type { RewardPickerTab } from "../../reward-picker/constants";
import type { RewardPickerCopy, RewardPickerFilter } from "../../reward-picker/use-reward-picker";
import { CAMPAIGN_EDITOR_MESSAGES as M } from "../messages";

/** Wallet-only rewards (no home island, rewards on): gems and XP from the Misc tab. */
export const WALLET_REWARD_TABS: readonly RewardPickerTab[] = ["misc"];
export const WALLET_REWARD_FILTER: RewardPickerFilter = entry => isRewardKindPaid("wallet", entry.kind);

/** Launch cargo holds wares, settlers and soldiers by type; cargo soldiers carry no rank (the base recruit). */
export const LAUNCH_CARGO_TABS: readonly RewardPickerTab[] = ["wares", "people"];
export const CARGO_SOLDIER_RANK = 0;
export const LAUNCH_CARGO_FILTER: RewardPickerFilter = entry =>
  entry.kind !== "soldier" || entry.rank === CARGO_SOLDIER_RANK;
export const LAUNCH_CARGO_COPY: RewardPickerCopy = {
  empty: M.gameMode.launch.empty, selected: M.gameMode.launch.selected, title: M.gameMode.launch.pickerTitle
};
