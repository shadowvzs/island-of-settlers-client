import { useLingui } from "@lingui/react";
import { useState } from "react";

import type { ScriptVariable } from "../../../../../../island-of-settlers-shared/src/script/types/script";
import type { ScriptValue, ValueType } from "../../../../../../island-of-settlers-shared/src/script/types/values";
import { translateMessage } from "../../../../shared/i18n/translate";
import type { ScriptWorkspace } from "../script-workspace";
import { useDescribeContext, useFocusRequest, useIssueIndex, useWorkspaceState } from "../use-script-workspace";
import { describeUsers } from "../users";
import { type EditableVariableType, VARIABLE_TYPES } from "./constants";
import { filterVariables, typeLabel, variableRow } from "./helpers";
import { VARIABLE_MESSAGES as M } from "./messages";
import {
  addVariable, removeVariable, replaceVariable, retypeVariable, type VariableEditResult
} from "./variable-edits";

/** The Variables tab (design §13.4): search, "+ Variable" of a type, the variable cards and their commands. */
export const useVariablePanel = (workspace: ScriptWorkspace) => {
  const { i18n } = useLingui();
  const state = useWorkspaceState(workspace);
  const context = useDescribeContext(state);
  const issues = useIssueIndex(state);
  const [query, setQuery] = useState("");
  const [newType, setNewType] = useState<EditableVariableType>("number");
  const [linkedId, setLinkedId] = useState<string | null>(null);
  useFocusRequest(state, "variables", id => { setQuery(""); setLinkedId(id); });
  const { script } = state;
  const text = (descriptor: Parameters<typeof translateMessage>[1], values?: Record<string, string | number>) =>
    translateMessage(i18n, descriptor, values);
  const current = (id: string) => workspace.getSnapshot().script.variables.find(item => item.id === id);
  const update = (id: string, change: (variable: ScriptVariable) => ScriptVariable) => {
    const variable = current(id);
    if (variable) workspace.commit(replaceVariable(workspace.getSnapshot().script, change(variable)));
  };
  const apply = (result: VariableEditResult, refusal: typeof M.deleteRefused, name: string) => {
    if (result.changed) { workspace.commit(result.script); return; }
    workspace.setNotice(text(refusal, { name, users: describeUsers(result.users, context) }), true);
  };
  const shown = filterVariables(script.variables, query);
  return {
    labels: {
      add: text(M.add), addItem: text(M.addItem), addType: text(M.addType), boardNote: text(M.boardNote),
      comment: text(M.comment), empty: text(M.empty), info: text(M.info), initial: text(M.initial),
      maxLength: text(M.maxLength), name: text(M.name), noRegion: text(M.noRegion),
      questVisible: text(M.questVisible), runtime: text(M.runtime), search: text(M.search),
      timerAutoStart: text(M.timerAutoStart), timerPeriodic: text(M.timerPeriodic),
      timerSeconds: text(M.timerSeconds), timerTitle: text(M.timerTitle), timerWindow: text(M.timerWindow),
      title: text(M.tab), type: text(M.type), yes: text(M.yes)
    },
    linkedId,
    newType,
    newTypes: VARIABLE_TYPES.map(type => ({ key: type, label: typeLabel(i18n, type) })),
    query,
    regions: script.regions.map(region => ({ key: region.id, label: region.name })),
    rows: shown.map(variable => variableRow(variable, script.variables.indexOf(variable), context, issues)),
    onAdd: () => workspace.commit(addVariable(workspace.getSnapshot().script, newType).script),
    onComment: (id: string, comment: string) => update(id, variable => {
      const { comment: _old, ...rest } = variable;
      return comment.trim() ? { ...rest, comment } : rest;
    }),
    onDelete: (variable: ScriptVariable) =>
      apply(removeVariable(workspace.getSnapshot().script, variable.id), M.deleteRefused, variable.name),
    onInitial: (id: string, initial: ScriptValue) => update(id, variable => ({ ...variable, initial })),
    onMaxLength: (id: string, length: number) => {
      if (Number.isInteger(length) && length > 0) update(id, variable => ({ ...variable, maxLength: length }));
    },
    onName: (id: string, name: string) => update(id, variable => ({ ...variable, name: name.trim() })),
    onNewType: (type: string) => setNewType(type as EditableVariableType),
    onQuery: setQuery,
    onQuestVisible: (id: string, on: boolean) => update(id, variable => ({ ...variable, questVisible: on })),
    onType: (variable: ScriptVariable, type: string) => apply(retypeVariable(workspace.getSnapshot().script,
      variable, type as ValueType), M.retypeRefused, variable.name)
  };
};

export type VariablePanelView = ReturnType<typeof useVariablePanel>;
