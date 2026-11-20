import { msg } from "@lingui/core/macro";

export const REWARD_ICON_MESSAGES = {
  experience: msg({ id: "rewardIcons.experience", message: "Experience (XP)" }),
  more: msg({ id: "rewardIcons.more", message: "+{count} more" }),
  moreLabel: msg({ id: "rewardIcons.moreLabel", message: "{count} more rewards: {names}" }),
  settlers: msg({ id: "rewardIcons.settlers", message: "Settlers" }),
  soldierRank: msg({ id: "rewardIcons.soldierRank", message: "{name} (rank {rank})" }),
  soldierRecruit: msg({ id: "rewardIcons.soldierRecruit", message: "{name} (recruit)" }),
  soldierRecruitRank: msg({ id: "rewardIcons.soldierRecruitRank", message: "{name} (rank {rank}, recruit)" }),
  unknown: msg({ id: "rewardIcons.unknown", message: "Reward: {id}" }),
  unlock: msg({ id: "rewardIcons.unlock", message: "Unlocks {name}" })
};
