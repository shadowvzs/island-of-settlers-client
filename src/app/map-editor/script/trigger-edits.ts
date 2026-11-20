import type {
  Condition, ScriptAction, ScriptEvent, ScriptTrigger, WaitSpec
} from "../../../../../island-of-settlers-shared/src/script/types/triggers";
import { wrapSteps } from "./factory";
import { getAtPath, type NodePath, setAtPath } from "./paths";
import { moveListItem, nextStepId, withFreshStepIds } from "./script-document";

/**
 * Pure edits of one script node (a trigger or a quest) addressed by node paths (the rows' paths): insert, move,
 * remove, duplicate, toggle, wrap and the event wording. Step ids stay unique across the node's action lists.
 */

/** Action list fields of the nodes that hold steps (trigger `actions`, quest `onActivate`/`onSuccess`/`onFailure`). */
export const STEP_LIST_FIELDS = ["actions", "onActivate", "onSuccess", "onFailure"] as const;

/** Every step of a node's action lists (their ids share one numbering). */
export const nodeSteps = (node: object): ScriptAction[] => STEP_LIST_FIELDS.flatMap(field => {
  const list = (node as Record<string, unknown>)[field];
  return Array.isArray(list) ? list as ScriptAction[] : [];
});

/** True when the path names a step (inside one of the node's action lists). */
export const isStepPath = (path: NodePath) => (STEP_LIST_FIELDS as readonly unknown[]).includes(path[0]);

const listAt = <T>(node: object, listPath: NodePath): T[] => {
  const value = getAtPath(node, listPath);
  return Array.isArray(value) ? value as T[] : [];
};

const parentList = (path: NodePath) => ({ index: path.at(-1) as number, listPath: path.slice(0, -1) });

export const addEvent = (trigger: ScriptTrigger, event: ScriptEvent): ScriptTrigger =>
  ({ ...trigger, events: [...trigger.events, event] });

/** Appends a condition to a group's `of` list (the root `conditions.of` for "+ condition"). */
export const addCondition = <T extends object>(node: T, listPath: NodePath, condition: Condition): T => {
  const target = getAtPath(node, listPath);
  if (Array.isArray(target)) return setAtPath(node, listPath, [...target, condition]);
  // The `of` of a `not` holds one condition: adding to it replaces an empty group.
  return setAtPath(node, listPath, condition);
};

/** "+ condition" of a root condition (trigger IF, quest objective/failure): appends, wrapping a single one in "all". */
export const addRootCondition = <T extends object>(node: T, rootPath: NodePath, condition: Condition): T => {
  const root = getAtPath(node, rootPath) as Condition | null | undefined;
  if (!root) return setAtPath(node, rootPath, { k: "all", of: [condition] });
  if (root.k === "all" || root.k === "any") return setAtPath(node, rootPath, { ...root, of: [...root.of, condition] });
  return setAtPath(node, rootPath, { k: "all", of: [root, condition] });
};

/** Appends steps to an action list (the step ids are renumbered to stay unique in the node). */
export const addSteps = <T extends object>(node: T, listPath: NodePath, steps: readonly ScriptAction[]) =>
  setAtPath(node, listPath, [...listAt<ScriptAction>(node, listPath), ...withFreshStepIds(steps, nodeSteps(node))]);

/** The id a new step of this node gets. */
export const newStepId = (node: object) => nextStepId(nodeSteps(node));

/** Moves a list item (event, condition or step) up or down inside its list. */
export const moveNode = <T extends object>(node: T, path: NodePath, offset: number): T => {
  const { index, listPath } = parentList(path);
  const list = getAtPath(node, listPath);
  if (!Array.isArray(list)) return node;
  return setAtPath(node, listPath, moveListItem(list, index, offset));
};

/** Removes a list item; a single condition (under a `not`, or a root condition) becomes an empty group. */
export const removeNode = <T extends object>(node: T, path: NodePath): T => {
  const { index, listPath } = parentList(path);
  const list = getAtPath(node, listPath);
  if (Array.isArray(list)) return setAtPath(node, listPath, list.filter((_, position) => position !== index));
  return setAtPath(node, path, { k: "all", of: [] });
};

/** Duplicates a list item below itself (a duplicated step gets fresh ids). */
export const duplicateNode = <T extends object>(node: T, path: NodePath): T => {
  const { index, listPath } = parentList(path);
  const list = getAtPath(node, listPath);
  if (!Array.isArray(list)) return node;
  const item = list[index] as unknown;
  const copy = listPath.at(-1) === "events" || !isStep(item) ? structuredClone(item)
    : withFreshStepIds([item], nodeSteps(node))[0];
  return setAtPath(node, listPath, [...list.slice(0, index + 1), copy, ...list.slice(index + 1)]);
};

const isStep = (value: unknown): value is ScriptAction =>
  typeof value === "object" && value !== null && "id" in value && "k" in value;

/** Turns a step off or on (kept but skipped). */
export const toggleStep = <T extends object>(node: T, path: NodePath): T => {
  const step = getAtPath(node, path) as ScriptAction | undefined;
  if (!step) return node;
  return setAtPath(node, [...path, "disabled"], step.disabled ? undefined : true);
};

export const setStepComment = <T extends object>(node: T, path: NodePath, comment: string) =>
  setAtPath(node, [...path, "comment"], comment.trim() ? comment : undefined);

/** Wraps one step in an `if` (then branch) or a `forEach` (body). */
export const wrapStep = <T extends object>(node: T, path: NodePath, kind: "if" | "forEach"): T => {
  const step = getAtPath(node, path) as ScriptAction | undefined;
  if (!step) return node;
  return setAtPath(node, path, wrapSteps([step], kind, nextStepId(nodeSteps(node))));
};

/** Switches a two-actor event between its primary and inverse wording (same kind, same slots). */
export const togglePhrasing = (trigger: ScriptTrigger, path: NodePath): ScriptTrigger => {
  const event = getAtPath(trigger, path) as ScriptEvent | undefined;
  if (!event) return trigger;
  return setAtPath(trigger, [...path, "phrasing"], event.phrasing === "inverse" ? undefined : "inverse");
};

/** "Wait until done" on or off for a long action (default timeout, continue on failure). */
export const setStepWait = <T extends object>(node: T, path: NodePath, wait: WaitSpec | undefined) =>
  setAtPath(node, [...path, "wait"], wait);

export const setStepField = <T extends object>(node: T, path: NodePath, field: string, value: unknown) =>
  setAtPath(node, [...path, field], value);

/** A copy of the steps at `paths` (for the clipboard). */
export const stepsAt = (node: object, paths: readonly NodePath[]) =>
  paths.map(path => getAtPath(node, path)).filter(isStep).map(step => structuredClone(step));
