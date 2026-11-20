import { actionDef, isScriptActionKind } from "../../../../../island-of-settlers-shared/src/script/catalog/actions";
import { eventDef, isScriptEventKind } from "../../../../../island-of-settlers-shared/src/script/catalog/events";
import { eventPhrasings } from "../../../../../island-of-settlers-shared/src/script/catalog/phrasings";
import {
  isScriptPredicateKind, PREDICATE_CATALOG
} from "../../../../../island-of-settlers-shared/src/script/catalog/predicates";
import {
  ALWAYS_AVAILABLE_RESPONSES, COMPARE_OPERATORS
} from "../../../../../island-of-settlers-shared/src/script/constants";
import { isScriptRef } from "../../../../../island-of-settlers-shared/src/script/references";
import type {
  Condition, ScriptAction, ScriptEvent, ScriptTrigger
} from "../../../../../island-of-settlers-shared/src/script/types/triggers";
import type { EventResponseKey } from "../../../../../island-of-settlers-shared/src/script/types/values";
import {
  type BlockPart, createSlotPart, EMPTY_SCOPE, type LocalInfo, offeredSlots, type PartScope, type PickerSpec,
  sentenceParts
} from "./block-parts";
import type { DescribeContext } from "./describe";
import { type NodePath, pathKey } from "./paths";
import { actionSentence, conditionSentence, eventSentence, flowSentence, predicateSentence } from "./sentences";

/**
 * Sentence blocks of a trigger (design §13.2): event rows, condition rows (groups nested) and action rows (if/else
 * branches and loop bodies nested), each with its parts and the path of the node it edits.
 */

export interface SentenceBlock {
  comment?: string;
  disabled: boolean;
  key: string;
  parts: BlockPart[];
  path: NodePath;
}

export interface EventRow extends SentenceBlock {
  /** The other wording exists (two-actor events) and may be chosen now. */
  canInvert: boolean;
  phrasing: "primary" | "inverse";
}

/** Where a new row is inserted: the list path and the index. */
export interface ListSlot {
  index: number;
  listPath: NodePath;
}

export interface WaitOption {
  onFail: "continue" | "stop";
  timeoutSeconds: number;
}

export interface StepOptions {
  /** `runTrigger` switches. */
  runTrigger?: { checkConditions: boolean; wait: boolean };
  /** Whether "player cannot override" applies; null: not a unit order. */
  overridable: boolean | null;
  /** The step can be waited on: its current wait (null: does not wait). */
  wait: WaitOption | null | undefined;
}

export type ScriptRow =
  | { block: SentenceBlock; depth: number; kind: "condition"; group: "all" | "any" | "not" | null; slot: ListSlot }
  | { block: SentenceBlock; depth: number; kind: "step"; options: StepOptions; slot: ListSlot; stepKind: string }
  | { depth: number; key: string; kind: "branch"; label: "thenBranch" | "elseBranch" | "loopBody" }
  | { depth: number; key: string; kind: "addCondition"; listPath: NodePath }
  | { depth: number; key: string; kind: "addAction"; listPath: NodePath };

const isSubjectEvent = (event: ScriptEvent) => isScriptEventKind(event.kind) && eventDef(event.kind).subject !== null;

/** Responses every firing of the trigger provides (the validator's intersection rule) plus the always-on ones. */
export const triggerResponses = (trigger: ScriptTrigger): EventResponseKey[] => {
  const sets = trigger.events.filter(event => isScriptEventKind(event.kind)).map(event => new Set<EventResponseKey>([
    ...eventDef(event.kind).responses, ...(isSubjectEvent(event) ? ["triggeringPlayer" as const] : [])
  ]));
  const [first, ...rest] = sets;
  const shared = first ? [...first].filter(key => rest.every(set => set.has(key))) : [];
  return [...new Set([...shared, ...ALWAYS_AVAILABLE_RESPONSES])];
};

const PLAYER_SPEC: PickerSpec = { allowResponse: false, kind: "player" };

/** One event row: its sentence (primary or inverse wording) with the player filter as a slot. */
export const eventRow = (event: ScriptEvent, path: NodePath, context: DescribeContext): EventRow => {
  const phrasing = event.phrasing ?? "primary";
  const base = { canInvert: false, disabled: false, key: pathKey(path), path, phrasing };
  if (!isScriptEventKind(event.kind)) return { ...base, parts: [{ kind: "text", text: String(event.kind) }] };
  const def = eventDef(event.kind);
  const hasPlayerSlot = def.slots.some(slot => slot.name === "player");
  const player = createSlotPart("player", PLAYER_SPEC, [...path, "player"], event.player, false, context);
  const parts = sentenceParts(eventSentence(event.kind, phrasing, context.locale), def.slots, {
    context, mode: "event", scope: EMPTY_SCOPE, subject: { capability: def.capability, name: def.subject },
    values: event.slots
  }, [...path, "slots"], hasPlayerSlot ? {} : { player });
  return { ...base, canInvert: Boolean(eventPhrasings(event.kind)), parts };
};

const compareParts = (condition: Extract<Condition, { k: "compare" }>, path: NodePath, scope: PartScope,
  context: DescribeContext): BlockPart[] => {
  const operand: PickerSpec = { kind: "value", scope, type: null };
  return [
    createSlotPart("a", operand, [...path, "a"], condition.a, false, context), { kind: "text", text: " " },
    createSlotPart("op", { kind: "choice", values: COMPARE_OPERATORS }, [...path, "op"],
      { k: "lit", type: "string", value: condition.op }, false, context),
    { kind: "text", text: " " }, createSlotPart("b", operand, [...path, "b"], condition.b, false, context)
  ];
};

const conditionParts = (condition: Condition, path: NodePath, scope: PartScope, context: DescribeContext) => {
  switch (condition.k) {
    case "compare": return compareParts(condition, path, scope, context);
    case "bool": return [
      createSlotPart("of", { kind: "value", scope, type: "boolean" }, [...path, "of"], condition.of, false, context),
      { kind: "text" as const, text: ` ${conditionSentence("bool", context.locale).replace("{of}", "").trim()}` }
    ];
    case "is": {
      if (!isScriptPredicateKind(condition.pred)) return [{ kind: "text" as const, text: String(condition.pred) }];
      return sentenceParts(predicateSentence(condition.pred, context.locale), PREDICATE_CATALOG[condition.pred].args,
        { context, mode: "query", scope, values: condition.args }, [...path, "args"]);
    }
    default: return [{ kind: "text" as const, text: conditionSentence(condition.k, context.locale) }];
  }
};

const conditionGroup = (condition: Condition) =>
  (condition.k === "all" || condition.k === "any" || condition.k === "not" ? condition.k : null);

/**
 * Condition rows below a group: the root group itself has no row (its children are the trigger's "if"), nested
 * groups get a row and an "add" row for their children.
 */
export const conditionRows = (
  condition: Condition, path: NodePath, scope: PartScope, context: DescribeContext, depth = 0, root = true,
  slot: ListSlot = { index: 0, listPath: path }
): ScriptRow[] => {
  const rows: ScriptRow[] = [];
  const group = conditionGroup(condition);
  if (!root || !group) rows.push({ block: { disabled: false, key: pathKey(path),
    parts: conditionParts(condition, path, scope, context), path }, depth, group, kind: "condition", slot });
  const childDepth = root ? depth : depth + 1;
  if (condition.k === "not") rows.push(...conditionRows(condition.of, [...path, "of"], scope, context,
    childDepth, false, { index: 0, listPath: [...path, "of"] }));
  if (condition.k !== "all" && condition.k !== "any") return rows;
  const listPath = [...path, "of"];
  condition.of.forEach((child, index) => rows.push(...conditionRows(child, [...listPath, index], scope, context,
    childDepth, false, { index, listPath })));
  if (!root) rows.push({ depth: childDepth, key: `${pathKey(listPath)}+`, kind: "addCondition", listPath });
  return rows;
};

const UNIT_ORDER_SLOTS = new Set(["actor", "ship"]);

const doOptions = (step: Extract<ScriptAction, { k: "do" }>): StepOptions => {
  if (!isScriptActionKind(step.op)) return { overridable: null, wait: undefined };
  const def = actionDef(step.op);
  const ordersUnit = !def.presentation && def.args.some(arg => arg.type.kind === "actor" && UNIT_ORDER_SLOTS.has(
    arg.name));
  return { overridable: ordersUnit ? step.overridable ?? true : null, wait: def.wait ? step.wait ?? null : undefined };
};

const stepOptions = (step: ScriptAction): StepOptions => {
  if (step.k === "do") return doOptions(step);
  if (step.k === "runTrigger") return { overridable: null, runTrigger: { checkConditions: step.checkConditions,
    wait: step.wait }, wait: undefined };
  return { overridable: null, wait: undefined };
};

const NUMBER = (scope: PartScope): PickerSpec => ({ kind: "value", scope, type: "number" });

/** A `forEach` item is an actor when the loop runs over actors, else typed by the array variable at run time. */
const loopLocal = (step: Extract<ScriptAction, { k: "forEach" }>): LocalInfo =>
  ({ name: step.as, type: isScriptRef(step.over) ? null : "actor" });

const loopLocalOf = (step: ScriptAction): LocalInfo | null => {
  if (step.k === "forEach") return loopLocal(step);
  if (step.k === "forRange") return { name: step.as, type: "number" };
  return null;
};

const flowParts = (step: ScriptAction, path: NodePath, scope: PartScope, context: DescribeContext): BlockPart[] => {
  const template = flowSentence(step.k, context.locale);
  const slot = (name: string, spec: PickerSpec, optional = false) =>
    createSlotPart(name, spec, [...path, name], (step as unknown as Record<string, unknown>)[name], optional,
      context);
  const slots: Record<string, BlockPart> = {};
  switch (step.k) {
    case "wait": slots.seconds = slot("seconds", NUMBER(scope)); break;
    case "waitUntil": slots.timeoutSeconds = slot("timeoutSeconds", { kind: "plainNumber", nullable: true }, true);
      break;
    case "forEach":
      slots.as = slot("as", { kind: "name" });
      slots.over = slot("over", { kind: "actor", mode: "query", requires: null, scope, subject: false });
      break;
    case "forRange":
      slots.as = slot("as", { kind: "name" });
      slots.from = slot("from", NUMBER(scope));
      slots.to = slot("to", NUMBER(scope));
      break;
    case "repeat": slots.times = slot("times", NUMBER(scope)); break;
    case "runTrigger": slots.trigger = slot("trigger", { kind: "ref", ref: "trigger", scope }); break;
    case "comment": slots.text = slot("text", { kind: "plainText" }); break;
    default: break;
  }
  return sentenceParts(template, [], { context, mode: "action", scope, values: {} }, path,
    { ...slots, cond: { kind: "text", text: "…" } });
};

const stepParts = (step: ScriptAction, path: NodePath, scope: PartScope, context: DescribeContext) => {
  if (step.k !== "do") return flowParts(step, path, scope, context);
  if (!isScriptActionKind(step.op)) return [{ kind: "text" as const, text: String(step.op) }];
  return sentenceParts(actionSentence(step.op, context.locale),
    offeredSlots(actionDef(step.op).args, step.args, context),
    { context, mode: "action", scope, values: step.args }, [...path, "args"]);
};

const branch = (label: "thenBranch" | "elseBranch" | "loopBody", listPath: NodePath, depth: number): ScriptRow =>
  ({ depth, key: `${pathKey(listPath)}:${label}`, kind: "branch", label });

const ifRows = (step: Extract<ScriptAction, { k: "if" }>, path: NodePath, scope: PartScope,
  context: DescribeContext, depth: number): ScriptRow[] => [
  branch("thenBranch", [...path, "then"], depth + 1),
  ...actionRows(step.then, [...path, "then"], scope, context, depth + 2),
  branch("elseBranch", [...path, "else"], depth + 1),
  ...actionRows(step.else, [...path, "else"], scope, context, depth + 2)
];

const nestedRows = (step: ScriptAction, path: NodePath, scope: PartScope, context: DescribeContext,
  depth: number): ScriptRow[] => {
  if (step.k === "if" || step.k === "waitUntil") {
    const condition = conditionRows(step.cond, [...path, "cond"], scope, context, depth + 1, false,
      { index: 0, listPath: [...path, "cond"] });
    return step.k === "if" ? [...condition, ...ifRows(step, path, scope, context, depth)] : condition;
  }
  if (step.k !== "forEach" && step.k !== "forRange" && step.k !== "repeat") return [];
  const local = loopLocalOf(step);
  const inner = local ? { ...scope, locals: [...scope.locals, local] } : scope;
  return [branch("loopBody", [...path, "body"], depth + 1),
    ...actionRows(step.body, [...path, "body"], inner, context, depth + 2)];
};

/** Action rows of a list (nested branches included) and the list's own "+ action" row. */
export const actionRows = (
  actions: readonly ScriptAction[], listPath: NodePath, scope: PartScope, context: DescribeContext, depth = 0
): ScriptRow[] => {
  const rows: ScriptRow[] = [];
  actions.forEach((step, index) => {
    const path = [...listPath, index];
    rows.push({
      block: { comment: step.comment, disabled: Boolean(step.disabled), key: pathKey(path),
        parts: stepParts(step, path, scope, context), path },
      depth, kind: "step", options: stepOptions(step), slot: { index, listPath }, stepKind: step.k
    });
    rows.push(...nestedRows(step, path, scope, context, depth));
  });
  rows.push({ depth, key: `${pathKey(listPath)}+`, kind: "addAction", listPath });
  return rows;
};

/** Every block of a trigger form. */
export const triggerBlocks = (trigger: ScriptTrigger, context: DescribeContext) => {
  const scope: PartScope = { locals: [], responses: triggerResponses(trigger) };
  return {
    actions: actionRows(trigger.actions, ["actions"], scope, context),
    conditions: conditionRows(trigger.conditions, ["conditions"], scope, context),
    events: trigger.events.map((event, index) => eventRow(event, ["events", index], context)),
    scope
  };
};

export type TriggerBlocks = ReturnType<typeof triggerBlocks>;
