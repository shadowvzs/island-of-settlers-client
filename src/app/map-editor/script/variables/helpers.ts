import type { I18n } from "@lingui/core";

import type { TimerDefinition } from "../../../../../../island-of-settlers-shared/src/script/types/multiboards";
import type { ScriptVariable } from "../../../../../../island-of-settlers-shared/src/script/types/script";
import type { ScriptValue, ValueType } from "../../../../../../island-of-settlers-shared/src/script/types/values";
import { translateMessage } from "../../../../shared/i18n/translate";
import { foldSearchText } from "../../reward-picker/catalog";
import type { DescribeContext } from "../describe";
import { describeUsers } from "../users";
import { itemIssues, type ScriptIssueIndex } from "../validation";
import { VARIABLE_TYPES } from "./constants";
import { VARIABLE_MESSAGES as M } from "./messages";
import { variableUsers } from "./variable-edits";

/** Which initial-value editor a variable row shows. */
export type InitialEditorKind = "array" | "board" | "boolean" | "number" | "region" | "runtime" | "string" | "text"
  | "timer";

const EDITOR_KINDS: Readonly<Partial<Record<ValueType, InitialEditorKind>>> = {
  actor: "runtime", actorGroup: "runtime", boolean: "boolean", multiboard: "board", number: "number",
  "number[]": "array", region: "region", string: "string", "string[]": "array", text: "text", timer: "timer"
};

export const initialEditorKind = (type: ValueType): InitialEditorKind => EDITOR_KINDS[type] ?? "string";

/** The type menu: the editable types (a board keeps its own type, shown but not offered). */
export const variableTypeOptions = (i18n: I18n | undefined, current: ValueType) => {
  const types: readonly ValueType[] = (VARIABLE_TYPES as readonly ValueType[]).includes(current) ? VARIABLE_TYPES
    : [current, ...VARIABLE_TYPES];
  return types.map(type => ({ key: type, label: typeLabel(i18n, type) }));
};

export const typeLabel = (i18n: I18n | undefined, type: ValueType) => {
  const descriptor = (M.types as Partial<Record<ValueType, typeof M.types.number>>)[type];
  return descriptor ? translateMessage(i18n, descriptor) : type;
};

/** Variables whose name or comment holds every word of the query. */
export const filterVariables = (variables: readonly ScriptVariable[], query: string) => {
  const words = foldSearchText(query).split(/\s+/).filter(Boolean);
  return variables.filter(item => {
    const text = foldSearchText(`${item.name} ${item.comment ?? ""}`);
    return words.every(word => text.includes(word));
  });
};

/** The items of an array variable with their input and remove labels; empty for other types. */
const arrayItems = (variable: ScriptVariable, i18n: I18n | undefined) => {
  const value = variable.initial.value;
  if (!Array.isArray(value) || initialEditorKind(variable.type) !== "array") return [];
  return (value as (number | string)[]).map((item, index) => ({
    index, label: translateMessage(i18n, M.item, { number: index + 1 }),
    removeLabel: translateMessage(i18n, M.removeItem, { number: index + 1 }), value: String(item)
  }));
};

/** One prepared variable card. */
export const variableRow = (variable: ScriptVariable, index: number, context: DescribeContext,
  issues: ScriptIssueIndex) => {
  const { i18n } = context;
  const users = variableUsers(context.script, variable.id);
  const usedBy = describeUsers(users, context);
  return {
    comment: variable.comment ?? "",
    deleteLabel: translateMessage(i18n, M.delete, { name: variable.name }),
    editor: initialEditorKind(variable.type),
    id: variable.id,
    items: arrayItems(variable, i18n),
    issues: itemIssues(issues, "variable", index),
    name: variable.name,
    questVisible: Boolean(variable.questVisible),
    types: variableTypeOptions(i18n, variable.type),
    usedBy: users.length ? translateMessage(i18n, M.usedBy, { users: usedBy }) : translateMessage(i18n, M.unused),
    variable
  };
};

export type VariableRow = ReturnType<typeof variableRow>;

/** A region variable's value from the select ("" = no region). */
export const regionValue = (id: string): ScriptValue => ({ type: "region", value: id
  ? { id, k: "ref", kind: "region" } : null });

/** A timer's length from its input: whole seconds, at least 1. */
export const timerSeconds = (text: string) => Math.max(1, Math.round(Number(text) || 1));

/** The countdown window of a timer switched on (empty title) or off. */
export const timerWindow = (on: boolean): TimerDefinition["window"] => (on ? { title: { en: "" } } : null);
