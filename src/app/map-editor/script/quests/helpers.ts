import type { I18n } from "@lingui/core";

import { QUEST_LIST_RESPONSES } from "../../../../../../island-of-settlers-shared/src/script/constants";
import { isScriptRef } from "../../../../../../island-of-settlers-shared/src/script/references";
import type { QuestObjective, ScriptQuest } from "../../../../../../island-of-settlers-shared/src/script/types/quests";
import { displayQuestText } from "../../../../shared/i18n/quest-text";
import { translateMessage } from "../../../../shared/i18n/translate";
import { createSlotPart, type PartScope, type PickerSpec, type SlotPart } from "../block-parts";
import { actionRows, conditionRows } from "../blocks";
import { CATALOG_KINDS } from "../constants";
import type { DescribeContext } from "../describe";
import { type LinkedPath, listIssues, showBlock, showRows } from "../form-rows";
import { type NodePath, pathKey } from "../paths";
import { countErrors, type ShownIssue } from "../validation";
import { QUEST_MESSAGES as M } from "./messages";

/** Pure view preparation of the Quests tab (design §13.6): list rows and the quest form's sentence rows. */

/** What a quest's conditions and action lists may read: the quest itself (`quest` response). */
export const QUEST_SCOPE: PartScope = { locals: [], responses: QUEST_LIST_RESPONSES };

const NUMBER_SPEC: PickerSpec = { kind: "value", scope: QUEST_SCOPE, type: "number" };

export const questTitle = (quest: ScriptQuest, i18n: I18n | undefined) =>
  (quest.title && displayQuestText(quest.title, i18n)) || translateMessage(i18n, M.untitled);

/** The quest list in book order: title, silent badge, error count, move labels. */
export const questListRows = (quests: readonly ScriptQuest[], selectedId: string | null, i18n: I18n | undefined,
  issuesOf: (index: number) => readonly ShownIssue[]) => quests.map((quest, index) => {
  const name = questTitle(quest, i18n);
  const errors = countErrors(issuesOf(index));
  return {
    errors: errors ? `⚠ ${errors}` : "",
    first: index === 0,
    id: quest.id,
    last: index === quests.length - 1,
    moveDownLabel: translateMessage(i18n, M.moveDown, { name }),
    moveUpLabel: translateMessage(i18n, M.moveUp, { name }),
    selected: quest.id === selectedId,
    silent: quest.visibility === "hidden",
    title: name
  };
});

const single = (name: string, spec: PickerSpec, path: NodePath, value: unknown, issues: readonly ShownIssue[],
  context: DescribeContext, linked: LinkedPath) => showBlock({ disabled: false, key: pathKey(path),
  parts: [createSlotPart(name, spec, path, value, false, context)], path }, issues, linked);

/** The picker of a built-in objective's field, by the value it holds. */
const builtInSpec = (key: string, value: unknown): PickerSpec | null => {
  if (isScriptRef(value)) return value.kind === "content" ? { kind: "content", kinds: CATALOG_KINDS }
    : { kind: "ref", ref: value.kind, scope: QUEST_SCOPE };
  if (typeof value === "number") return { kind: "plainNumber", nullable: false };
  if (key === "quantifier") return { kind: "choice", values: ["any", "all"] };
  if (key === "unitFilter") return { kind: "choice", values: ["any", "soldier", "commander"] };
  return null;
};

/** The editable fields of a built-in objective (regions, actors, numbers…) as slots. */
const builtInParts = (objective: QuestObjective, context: DescribeContext): SlotPart[] =>
  Object.entries(objective).flatMap(([key, value]) => {
    const spec = key === "kind" ? null : builtInSpec(key, value);
    if (!spec) return [];
    const stored = spec.kind === "choice" ? { k: "lit", type: "string", value } : value;
    return [createSlotPart(key, spec, ["objective", key], stored, false, context)];
  });

/** Every sentence row of a quest form, with its issues and the deep link's field highlight. */
export const questBlocks = (
  quest: ScriptQuest, context: DescribeContext, issues: readonly ShownIssue[], linked: LinkedPath = null
) => {
  const { objective } = quest;
  const lists = (field: "onActivate" | "onFailure" | "onSuccess") => ({
    issues: listIssues(issues, [field]), rows: showRows(actionRows(quest[field], [field], QUEST_SCOPE, context),
      issues, linked)
  });
  const progress = objective.kind === "condition" && objective.progress ? [
    single("current", NUMBER_SPEC, ["objective", "progress", "current"], objective.progress.current, issues, context,
      linked),
    single("target", NUMBER_SPEC, ["objective", "progress", "target"], objective.progress.target, issues, context,
      linked)
  ] : [];
  return {
    builtIn: showBlock({ disabled: false, key: "objective", parts: builtInParts(objective, context),
      path: ["objective"] }, issues, linked),
    failure: quest.failure
      ? showRows(conditionRows(quest.failure, ["failure"], QUEST_SCOPE, context), issues, linked) : [],
    objective: objective.kind === "condition"
      ? showRows(conditionRows(objective.condition, ["objective", "condition"], QUEST_SCOPE, context), issues, linked)
      : [],
    onActivate: lists("onActivate"),
    onFailure: lists("onFailure"),
    onSuccess: lists("onSuccess"),
    progress
  };
};

export type QuestBlocks = ReturnType<typeof questBlocks>;

/** Issues of the quest's header fields (not of a row the form shows itself). */
const ROW_FIELDS = new Set(["objective", "failure", "onActivate", "onSuccess", "onFailure"]);
export const headerIssues = (issues: readonly ShownIssue[]) =>
  issues.filter(issue => !ROW_FIELDS.has(String(issue.path[0])));
