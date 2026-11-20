import type { I18n } from "@lingui/core";
import { useLingui } from "@lingui/react";

import { campaignRewardEntries } from "../../../../../../island-of-settlers-shared/src/script/engine/home-rewards";
import {
  questRewardEntries, questRewardsFromEntries
} from "../../../../../../island-of-settlers-shared/src/script/quest-rewards";
import type { QuestRewards, ScriptQuest } from "../../../../../../island-of-settlers-shared/src/script/types/quests";
import type { ScriptGoodsLine } from "../../../../../../island-of-settlers-shared/src/script/types/rewards";
import { translateMessage } from "../../../../shared/i18n/translate";
import type { RewardEntry } from "../../../settlement-ui/reward-icons/entries";
import { getRewardIconsView } from "../../../settlement-ui/reward-icons/helpers";
import { entriesToGoods, goodsToEntries } from "../slot-picker-model";
import type { ScriptDialogs } from "../use-script-dialogs";
import { QUEST_MESSAGES as M } from "./messages";

/**
 * Cost, map reward and home reward lines of a quest and the declared home rewards (design §13.6): the shared
 * reward icons, "Edit…" through the slot picker's RewardPicker, and the campaign replay share (one third, §9.5).
 */

type RewardKind = "goods" | "rewards";

/** One reward line: its icons and the picker that edits it. */
export const rewardLineView = (entries: readonly RewardEntry[], i18n: I18n | undefined, title: string,
  kind: RewardKind, dialogs: Pick<ScriptDialogs, "openPicker">, apply: (entries: RewardEntry[]) => void) => ({
  empty: entries.length === 0,
  icons: getRewardIconsView(entries, { i18n }),
  title,
  onEdit: () => dialogs.openPicker({ label: title, optional: false, spec: { kind },
    value: kind === "goods" ? entriesToGoods(entries) : entries,
    apply: value => apply(kind === "goods" ? goodsToEntries(value) : value as RewardEntry[]) })
});

export type RewardLineView = ReturnType<typeof rewardLineView>;

const entriesOf = (rewards: QuestRewards | null | undefined) =>
  (rewards ? questRewardEntries(rewards) : []) as RewardEntry[];

/** The quest's cost and rewards; on a campaign map also what a replay of the completed map pays. */
export const useQuestRewards = (quest: ScriptQuest, campaign: boolean, dialogs: ScriptDialogs,
  update: (change: Partial<ScriptQuest>) => void) => {
  const { i18n } = useLingui();
  const text = (descriptor: Parameters<typeof translateMessage>[1]) => translateMessage(i18n, descriptor);
  const home = entriesOf(quest.homeReward);
  const replay = campaignRewardEntries(home as Parameters<typeof campaignRewardEntries>[0], "completed");
  const rewardsOf = (entries: RewardEntry[]) =>
    questRewardsFromEntries(entries as Parameters<typeof questRewardsFromEntries>[0]);
  return {
    cost: rewardLineView(goodsToEntries(quest.cost), i18n, text(M.cost), "goods", dialogs,
      entries => update({ cost: entriesToGoods(entries) as ScriptGoodsLine[] })),
    home: rewardLineView(home, i18n, text(M.homeReward), "rewards", dialogs,
      entries => update({ homeReward: rewardsOf(entries) })),
    map: rewardLineView(entriesOf(quest.mapReward), i18n, text(M.mapReward), "rewards", dialogs,
      entries => update({ mapReward: rewardsOf(entries) })),
    nothing: text(M.nothing),
    edit: text(M.edit),
    replay: campaign && home.length > 0 ? {
      icons: getRewardIconsView(replay as RewardEntry[], { i18n }),
      note: text(replay.length ? M.replayNote : M.replayNothing),
      paid: replay.length > 0
    } : null
  };
};

export type QuestRewardsView = ReturnType<typeof useQuestRewards>;
