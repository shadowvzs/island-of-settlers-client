import type { I18n } from "@lingui/core";

import type { ScriptTrigger } from "../../../../../island-of-settlers-shared/src/script/types/triggers";
import { translateMessage } from "../../../shared/i18n/translate";
import type { BlockPart } from "./block-parts";
import { type ScriptRow, triggerBlocks } from "./blocks";
import type { DescribeContext } from "./describe";
import { SCRIPT_MESSAGES as M } from "./messages";

/**
 * The explain line (design §13.2, rev): one plain-language sentence generated from the same sentence blocks as the
 * form ("When Player 1's Hunter kills Deer family, if deerCount < 10, increase deerCount by 1").
 */

/** An unset optional slot appended as " · label: …" says nothing: its label is left out too. */
const isEmptyOption = (part: BlockPart | undefined) => part?.kind === "slot" && part.optional && !part.summary &&
  !part.children;

const partsText = (parts: readonly BlockPart[], unset: string): string => parts.map((part, index) => {
  if (part.kind === "text") return part.text.startsWith(" · ") && isEmptyOption(parts[index + 1]) ? "" : part.text;
  if (part.children) return partsText(part.children, unset);
  return part.summary || (part.optional ? "" : unset);
}).join("").replace(/\s+/g, " ").replace(/\s+([,.)])/g, "$1").replace(/\(\s*\)/g, "").trim();

const joinWith = (i18n: I18n | undefined, items: readonly string[], descriptor: typeof M.explain.or) =>
  items.reduce((first, second) => (first ? translateMessage(i18n, descriptor, { first, second }) : second), "");

interface ConditionNode {
  children: ConditionNode[];
  group: "all" | "any" | "not" | null;
  text: string;
}

/** Rebuilds the condition tree from the flat rows (depth order) so groups read as "a or b" / "not (…)". */
const conditionTree = (rows: readonly ScriptRow[], unset: string): ConditionNode[] => {
  const root: ConditionNode = { children: [], group: "all", text: "" };
  const stack: { depth: number; node: ConditionNode }[] = [{ depth: -1, node: root }];
  for (const row of rows) {
    if (row.kind !== "condition") continue;
    while (stack.length > 1 && stack.at(-1)!.depth >= row.depth) stack.pop();
    const node: ConditionNode = { children: [], group: row.group, text: partsText(row.block.parts, unset) };
    stack.at(-1)!.node.children.push(node);
    stack.push({ depth: row.depth, node });
  }
  return root.children;
};

const conditionText = (node: ConditionNode, i18n: I18n | undefined): string => {
  if (node.group === null) return node.text;
  const children = node.children.map(child => conditionText(child, i18n));
  if (node.group === "not") return translateMessage(i18n, M.explain.not, { condition: children.join(", ") });
  const joined = joinWith(i18n, children, node.group === "any" ? M.explain.or : M.explain.and);
  return translateMessage(i18n, M.explain.group, { conditions: joined });
};

const stepTexts = (rows: readonly ScriptRow[], depth: number, unset: string): string[] => rows
  .filter(row => row.kind === "step" && row.depth === depth && !row.block.disabled && row.stepKind !== "comment")
  .map(row => (row.kind === "step" ? partsText(row.block.parts, unset) : ""));

/** The explain line of a trigger in the active locale. */
export const explainTrigger = (trigger: ScriptTrigger, context: DescribeContext) => {
  const { i18n } = context;
  const unset = "…";
  const blocks = triggerBlocks(trigger, context);
  const events = joinWith(i18n, blocks.events.map(row => partsText(row.parts, unset)), M.explain.or);
  const conditions = joinWith(i18n, conditionTree(blocks.conditions, unset).map(node => conditionText(node, i18n)),
    M.explain.and);
  const actions = joinWith(i18n, stepTexts(blocks.actions, 0, unset), M.explain.sequence) ||
    translateMessage(i18n, M.explain.nothing);
  if (events && conditions) return translateMessage(i18n, M.explain.whenIfDo, { actions, conditions, events });
  if (events) return translateMessage(i18n, M.explain.whenDo, { actions, events });
  if (conditions) return translateMessage(i18n, M.explain.calledIfDo, { actions, conditions });
  return translateMessage(i18n, M.explain.calledDo, { actions });
};
