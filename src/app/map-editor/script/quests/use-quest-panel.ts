import { useLingui } from "@lingui/react";
import { useState } from "react";

import type { QuestGroup } from "../../../../../../island-of-settlers-shared/src/script/types/quests";
import { displayQuestText } from "../../../../shared/i18n/quest-text";
import { translateMessage } from "../../../../shared/i18n/translate";
import type { ScriptWorkspace } from "../script-workspace";
import { useFocusRequest, useIssueIndex, useWorkspaceState } from "../use-script-workspace";
import { itemIssues, scriptMapKind } from "../validation";
import { NEW_GROUP_TITLE, NEW_QUEST_TITLE } from "./constants";
import { questListRows } from "./helpers";
import { QUEST_MESSAGES as M } from "./messages";
import { addGroup, addQuest, moveQuest, removeGroup, replaceGroup, wholeNumber } from "./quest-edits";

/** The Quests tab (design §13.6): the quest list in book order, the selection and the quest groups. */
export const useQuestPanel = (workspace: ScriptWorkspace) => {
  const { i18n } = useLingui();
  const state = useWorkspaceState(workspace);
  const issueIndex = useIssueIndex(state);
  const { script } = state;
  const [selected, setSelected] = useState<string | null>(null);
  useFocusRequest(state, "quests", setSelected);
  const { groups, quests } = script.quests;
  const selectedQuest = quests.find(quest => quest.id === selected) ?? quests[0];
  const text = (descriptor: Parameters<typeof translateMessage>[1]) => translateMessage(i18n, descriptor);
  const updateGroup = (id: string, change: (group: QuestGroup) => QuestGroup) => {
    const current = workspace.getSnapshot().script;
    const group = current.quests.groups.find(item => item.id === id);
    if (group) workspace.commit(replaceGroup(current, change(group)));
  };
  return {
    campaign: scriptMapKind(workspace.world) === "campaign",
    groupLabels: {
      add: text(M.groups.add), delete: text(M.groups.delete), level: text(M.groups.level), name: text(M.groups.name),
      order: text(M.groups.order), parallel: text(M.groups.parallel), requires: text(M.groups.requires),
      sequential: text(M.groups.sequential), title: text(M.groups.title)
    },
    groups: groups.map(group => ({
      group,
      level: group.unlock ? String(group.unlock.level) : "",
      others: groups.filter(other => other.id !== group.id).map(other => ({
        checked: group.requiresGroups.includes(other.id), key: other.id,
        label: displayQuestText(other.title, i18n) || other.id }))
    })),
    quest: selectedQuest,
    rows: questListRows(quests, selectedQuest?.id ?? null, i18n, index => itemIssues(issueIndex, "quest", index)),
    onAdd: () => {
      const added = addQuest(workspace.getSnapshot().script, NEW_QUEST_TITLE);
      if (workspace.commit(added.script)) setSelected(added.quest.id);
    },
    onAddGroup: () => workspace.commit(addGroup(workspace.getSnapshot().script, NEW_GROUP_TITLE)),
    onDeleteGroup: (id: string) => {
      const next = removeGroup(workspace.getSnapshot().script, id);
      if (next) workspace.commit(next);
      else workspace.setNotice(text(M.groups.deleteRefused), true);
    },
    onGroupActivation: (id: string, value: string) => updateGroup(id, group => ({ ...group,
      activation: value === "sequential" ? "sequential" : "parallel" })),
    onGroupLevel: (id: string, value: string) => updateGroup(id, group => {
      const level = wholeNumber(value);
      return { ...group, unlock: level ? { kind: "playerLevel", level } : null };
    }),
    onGroupRequires: (id: string, other: string, on: boolean) => updateGroup(id, group => ({ ...group,
      requiresGroups: [...group.requiresGroups.filter(item => item !== other), ...(on ? [other] : [])] })),
    onGroupTitle: (id: string, title: QuestGroup["title"]) => updateGroup(id, group => ({ ...group, title })),
    onMove: (id: string, offset: number) => workspace.commit(moveQuest(workspace.getSnapshot().script, id, offset)),
    onSelect: setSelected
  };
};

export type QuestPanelView = ReturnType<typeof useQuestPanel>;
