import { useLingui } from "@lingui/react";
import { useMemo } from "react";

import type { QuestText } from "../../../../../../island-of-settlers-shared/src/script/types/quest-text";
import type { ScriptQuest } from "../../../../../../island-of-settlers-shared/src/script/types/quests";
import { displayQuestText } from "../../../../shared/i18n/quest-text";
import { translateMessage } from "../../../../shared/i18n/translate";
import { linkedFieldPath } from "../deep-link";
import type { ScriptWorkspace } from "../script-workspace";
import { slotOpener } from "../slot-opener";
import { createStepCommands, type RowHost } from "../step-commands";
import type { ScriptDialogs } from "../use-script-dialogs";
import { useDescribeContext, useIssueIndex, useWorkspaceState } from "../use-script-workspace";
import { describeUsers } from "../users";
import { itemIssues } from "../validation";
import { OBJECTIVE_CHOICES, type ObjectiveChoice } from "./constants";
import { headerIssues, questBlocks, questTitle } from "./helpers";
import { QUEST_MESSAGES as M } from "./messages";
import {
  objectiveChoice, objectiveOf, questUsers, removeQuest, replaceQuest, togglePrerequisite, wholeNumber, withProgress
} from "./quest-edits";

/** The quest as a row host: its conditions and action lists use the trigger form's rows and commands. */
const questHost = (workspace: ScriptWorkspace, quest: ScriptQuest): RowHost<ScriptQuest> => ({
  node: quest, triggers: workspace.getSnapshot().script.triggers,
  update: change => {
    const script = workspace.getSnapshot().script;
    const current = script.quests.quests.find(item => item.id === quest.id);
    if (current) workspace.commit(replaceQuest(script, change(current)));
  }
});

/** The quest form (design §13.6): texts, visibility, start, group, prerequisites, "Completed when", failure, lists. */
export const useQuestForm = (workspace: ScriptWorkspace, quest: ScriptQuest, dialogs: ScriptDialogs) => {
  const { i18n } = useLingui();
  const state = useWorkspaceState(workspace);
  const context = useDescribeContext(state);
  const issueIndex = useIssueIndex(state);
  const { script } = state;
  const index = script.quests.quests.indexOf(quest);
  const issues = itemIssues(issueIndex, "quest", index);
  const linked = useMemo(() => linkedFieldPath(state.focus, "quests", quest.id), [state.focus, quest.id]);
  const blocks = useMemo(() => questBlocks(quest, context, issues, linked), [quest, context, issues, linked]);
  const host = questHost(workspace, quest);
  const set = (change: Partial<ScriptQuest>) => host.update(current => ({ ...current, ...change }));
  const text = (descriptor: Parameters<typeof translateMessage>[1], values?: Record<string, string | number>) =>
    translateMessage(i18n, descriptor, values);
  const users = questUsers(script, quest.id);
  const choice = objectiveChoice(quest.objective);
  const prerequisites = new Set((quest.prerequisites ?? []).map(ref => ref.id));
  return {
    blocks,
    choice: choice ?? "builtIn",
    choices: [...OBJECTIVE_CHOICES.map(key => ({ key, label: text(M.objectives[key]) })),
      ...(choice ? [] : [{ key: "builtIn", label: text(M.objectives.builtIn, { kind: quest.objective.kind }) }])],
    groups: [{ key: "", label: text(M.noGroup) }, ...script.quests.groups.map(group => ({ key: group.id,
      label: displayQuestText(group.title, i18n) || group.id }))],
    headerIssues: headerIssues(issues),
    /** Goal issues without rows of their own (a counter, a built-in goal); condition rows list theirs. */
    objectiveIssues: choice === "condition" ? [] : blocks.builtIn.issues,
    others: script.quests.quests.filter(item => item.id !== quest.id).map(item => ({ checked: prerequisites.has(
      item.id), key: item.id, label: questTitle(item, i18n) })),
    quest,
    steps: createStepCommands(host, dialogs),
    usedBy: users.length ? text(M.usedBy, { users: describeUsers(users, context) }) : text(M.unused),
    onActivation: (value: string) => set({ activation: value === "action" ? "action" : "auto" }),
    onCounter: (counter: string) => host.update(current => (current.objective.kind === "counterReached"
      ? { ...current, objective: { ...current.objective, counter: counter.trim() } } : current)),
    onCounterSince: (since: string) => host.update(current => (current.objective.kind === "counterReached"
      ? { ...current, objective: { ...current.objective, since: since === "mapStart" ? "mapStart" : "activation" } }
      : current)),
    onCounterTarget: (target: string) => host.update(current => (current.objective.kind === "counterReached"
      ? { ...current, objective: { ...current.objective, target: Math.max(1, wholeNumber(target)) } } : current)),
    onDelete: () => {
      const result = removeQuest(workspace.getSnapshot().script, quest.id);
      if (result.changed) { workspace.commit(result.script); return; }
      workspace.setNotice(text(M.deleteRefused, { name: questTitle(quest, i18n),
        users: describeUsers(result.users, context) }), true);
    },
    onFields: set,
    onFailureOn: (on: boolean) => set({ failure: on ? { k: "all", of: [] } : null }),
    onGroup: (groupId: string) => set({ groupId: groupId || null }),
    onObjective: (key: string) => {
      if (key !== "builtIn") set({ objective: objectiveOf(key as ObjectiveChoice) });
    },
    onOpenSlot: slotOpener<ScriptQuest>(i18n, dialogs, host.update),
    onOptional: (optional: boolean) => set({ optional }),
    onPrerequisite: (id: string, on: boolean) => host.update(current => togglePrerequisite(current, id, on)),
    onProgress: (on: boolean) => host.update(current => ({ ...current, objective: withProgress(current.objective,
      on) })),
    onText: (field: "text" | "title", value: QuestText) => set({ [field]: value }),
    onVisibility: (value: string) => set({ visibility: value === "hidden" ? "hidden" : "visible" })
  };
};

export type QuestFormView = ReturnType<typeof useQuestForm>;
