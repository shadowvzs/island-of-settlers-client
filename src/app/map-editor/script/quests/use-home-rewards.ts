import { useLingui } from "@lingui/react";

import type {
  DeclaredHomeReward, DeclaredRewardOccurrence
} from "../../../../../../island-of-settlers-shared/src/script/types/script";
import { rewardScopeOf } from "../../../../shared/campaign/game-mode/reward-scope";
import { translateMessage } from "../../../../shared/i18n/translate";
import type { RewardEntry } from "../../../settlement-ui/reward-icons/entries";
import { useEditorMode } from "../../map-rules/use-editor-mode";
import type { ScriptWorkspace } from "../script-workspace";
import type { ScriptDialogs } from "../use-script-dialogs";
import { useDescribeContext, useIssueIndex, useWorkspaceState } from "../use-script-workspace";
import { describeUsers } from "../users";
import { itemIssues } from "../validation";
import { OCCURRENCE_KINDS } from "./constants";
import {
  addHomeReward, homeRewardUsers, occurrenceOf, removeHomeReward, replaceHomeReward
} from "./home-reward-edits";
import { QUEST_MESSAGES as M } from "./messages";
import { wholeNumber } from "./quest-edits";
import { rewardLineView } from "./use-quest-rewards";

/** The declared home rewards list on the Quests tab (design §4.14, §13.6). */
export const useHomeRewards = (workspace: ScriptWorkspace, dialogs: ScriptDialogs) => {
  const { i18n } = useLingui();
  const state = useWorkspaceState(workspace);
  const context = useDescribeContext(state);
  const issueIndex = useIssueIndex(state);
  const { script } = state;
  const rewardScope = rewardScopeOf(useEditorMode().settings);
  const text = (descriptor: Parameters<typeof translateMessage>[1], values?: Record<string, string | number>) =>
    translateMessage(i18n, descriptor, values);
  const update = (id: string, change: (reward: DeclaredHomeReward) => DeclaredHomeReward) => {
    const current = workspace.getSnapshot().script;
    const reward = current.homeRewards.find(item => item.id === id);
    if (reward) workspace.commit(replaceHomeReward(current, change(reward)));
  };
  const labels = {
    add: text(M.rewards.add), edit: text(M.edit), info: text(M.rewards.info), lines: text(M.rewards.lines),
    maxOccurrences: text(M.rewards.maxOccurrences), name: text(M.rewards.name), nothing: text(M.nothing),
    occurrence: text(M.rewards.occurrence), title: text(M.rewards.title)
  };
  return {
    cards: script.homeRewards.map((reward, index) => {
      const users = homeRewardUsers(script, reward.id);
      return {
        deleteLabel: text(M.rewards.delete, { name: reward.name }),
        id: reward.id,
        issues: itemIssues(issueIndex, "homeReward", index),
        line: rewardLineView(reward.rewards as RewardEntry[], i18n, labels.lines, "rewards", dialogs,
          entries => update(reward.id, current => ({ ...current, rewards: entries as DeclaredHomeReward["rewards"] }))),
        reward,
        usedBy: users.length ? text(M.usedBy, { users: describeUsers(users, context) }) : text(M.unused)
      };
    }),
    labels,
    /** What the game mode pays of these rewards (owner Q2); empty when every line is paid home. */
    modeNote: rewardScope === "all" ? "" : text(M.rewards.modeNotes[rewardScope]),
    occurrences: OCCURRENCE_KINDS.map(key => ({ key, label: text(M.rewards.occurrences[key]) })),
    onAdd: () => workspace.commit(addHomeReward(workspace.getSnapshot().script,
      text(M.rewards.newName, { number: script.homeRewards.length + 1 })).script),
    onDelete: (reward: DeclaredHomeReward) => {
      const result = removeHomeReward(workspace.getSnapshot().script, reward.id);
      if (result.changed) { workspace.commit(result.script); return; }
      workspace.setNotice(text(M.deleteRefused, { name: reward.name, users: describeUsers(result.users, context) }),
        true);
    },
    onMaxOccurrences: (id: string, value: string) => update(id, reward => (reward.occurrence.kind === "counter"
      ? { ...reward, occurrence: { ...reward.occurrence, maxOccurrences: Math.max(1, wholeNumber(value)) } }
      : reward)),
    onName: (id: string, name: string) => update(id, reward => ({ ...reward, name })),
    onOccurrence: (id: string, kind: string) => update(id, reward => ({ ...reward,
      occurrence: occurrenceOf(kind as DeclaredRewardOccurrence["kind"]) })),
    onWindow: (id: string, repeat: Extract<DeclaredRewardOccurrence, { kind: "window" }>["repeat"]) =>
      update(id, reward => ({ ...reward, occurrence: { kind: "window", repeat } }))
  };
};

export type HomeRewardsView = ReturnType<typeof useHomeRewards>;
