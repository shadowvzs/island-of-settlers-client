import { useLingui } from "@lingui/react";
import { useMemo } from "react";

import { scriptReferences, scriptUsersOf } from "../../../../../island-of-settlers-shared/src/script/references";
import type { ScriptTrigger } from "../../../../../island-of-settlers-shared/src/script/types/triggers";
import { translateMessage } from "../../../shared/i18n/translate";
import { triggerBlocks } from "./blocks";
import { copyTrigger } from "./clipboard";
import { TRIGGER_CONCURRENCY } from "./constants";
import { linkedFieldPath } from "./deep-link";
import { explainTrigger } from "./explain";
import { listIssues, showEventRow, showRows } from "./form-rows";
import { SCRIPT_MESSAGES as M } from "./messages";
import { setAtPath } from "./paths";
import { removeTrigger } from "./script-document";
import type { ScriptWorkspace } from "./script-workspace";
import { slotOpener } from "./slot-opener";
import { createStepCommands, triggerHost } from "./step-commands";
import type { ScriptDialogs } from "./use-script-dialogs";
import { useDescribeContext, useIssueIndex, useWorkspaceState } from "./use-script-workspace";
import { describeUsers } from "./users";
import { countErrors, countWarnings, triggerIssues } from "./validation";

const ROW_SECTIONS = new Set(["events", "conditions", "actions"]);

/** The trigger form's view model: header fields, Advanced, explain line, rows with issues and every command. */
export const useTriggerForm = (workspace: ScriptWorkspace, trigger: ScriptTrigger, dialogs: ScriptDialogs) => {
  const { i18n } = useLingui();
  const state = useWorkspaceState(workspace);
  const context = useDescribeContext(state);
  const index = state.script.triggers.indexOf(trigger);
  const issueIndex = useIssueIndex(state);
  const issues = triggerIssues(issueIndex, index);
  const blocks = useMemo(() => triggerBlocks(trigger, context), [trigger, context]);
  const linked = useMemo(() => linkedFieldPath(state.focus, "triggers", trigger.id), [state.focus, trigger.id]);
  const update = (change: (value: ScriptTrigger) => ScriptTrigger) => workspace.updateTrigger(trigger.id, change);
  const steps = createStepCommands(triggerHost(workspace, trigger), dialogs);
  const users = scriptUsersOf(scriptReferences(state.script), "trigger", trigger.id)
    .filter(owner => owner !== `trigger:${trigger.id}`);
  const openSlot = slotOpener(i18n, dialogs, update);
  const deleteTrigger = () => {
    if (users.length) {
      workspace.setNotice(translateMessage(i18n, M.form.deleteRefused,
        { users: describeUsers(users, context) }), true);
      return;
    }
    const rest = removeTrigger(state.script, trigger.id);
    workspace.commit(rest, { selectedTriggerId: rest.triggers[index]?.id ?? rest.triggers.at(-1)?.id ?? null });
  };
  return {
    actionRows: showRows(blocks.actions, issues, linked),
    actionsIssues: listIssues(issues, ["actions"]),
    comment: trigger.comment ?? "",
    concurrency: trigger.concurrency,
    concurrencyOptions: TRIGGER_CONCURRENCY.map(id => ({ id, label: translateMessage(i18n, M.form[id]) })),
    conditionRows: showRows(blocks.conditions, issues, linked),
    enabled: trigger.enabled,
    eventRows: blocks.events.map(row => showEventRow(row, issues, linked)),
    explain: explainTrigger(trigger, context),
    folderId: trigger.folderId ?? "",
    folders: [{ id: "", name: translateMessage(i18n, M.list.unsorted) }, ...state.script.folders],
    headerIssues: issues.filter(issue => !ROW_SECTIONS.has(String(issue.path[0]))),
    id: trigger.id,
    issueSummary: translateMessage(i18n, M.form.issueCount, { errors: countErrors(issues),
      warnings: countWarnings(issues) }),
    name: trigger.name,
    noEvents: trigger.events.length === 0,
    runLimit: trigger.runLimit === null ? "" : String(trigger.runLimit),
    usedBy: users.length ? translateMessage(i18n, M.form.usedBy, { users: describeUsers(users, context) })
      : translateMessage(i18n, M.form.notUsed),
    steps,
    onComment: (comment: string) => update(current => setAtPath(current, ["comment"], comment.trim() ? comment
      : undefined)),
    onConcurrency: (value: string) => update(current => ({ ...current,
      concurrency: value as ScriptTrigger["concurrency"] })),
    onCopy: () => copyTrigger(trigger),
    onDelete: deleteTrigger,
    onEnabled: (enabled: boolean) => update(current => ({ ...current, enabled })),
    onFolder: (folderId: string) => update(current => ({ ...current, folderId: folderId || null })),
    onName: (name: string) => update(current => ({ ...current, name })),
    onOpenSlot: openSlot,
    onRunLimit: (text: string) => {
      const value = Number.parseInt(text, 10);
      update(current => ({ ...current, runLimit: Number.isInteger(value) && value > 0 ? value : null }));
    }
  };
};

export type TriggerFormView = ReturnType<typeof useTriggerForm>;
