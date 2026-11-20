import { actionDef, type ScriptActionKind } from "../../../../../island-of-settlers-shared/src/script/catalog/actions";
import { eventDef, type ScriptEventKind } from "../../../../../island-of-settlers-shared/src/script/catalog/events";
import {
  PREDICATE_CATALOG, type ScriptPredicateKind
} from "../../../../../island-of-settlers-shared/src/script/catalog/predicates";
import type { SlotDef } from "../../../../../island-of-settlers-shared/src/script/catalog/slots";
import type { PlayerFilter } from "../../../../../island-of-settlers-shared/src/script/types/refs";
import type {
  Condition, ScriptAction, ScriptEvent
} from "../../../../../island-of-settlers-shared/src/script/types/triggers";
import type { Expr } from "../../../../../island-of-settlers-shared/src/script/types/values";
import {
  DEFAULT_FOR_EACH_MAX, DEFAULT_LOOP_NAME, DEFAULT_WAIT_TIMEOUT_SECONDS, type FlowStepKind, HUMAN_FACTION,
  UNSET_OPERAND_ID
} from "./constants";

/**
 * New events, conditions and steps as the "+" buttons create them. Every new node is shape-valid (the Ready check
 * stays meaningful): closed choices start at their first value, switches at "no", expressions at a literal; other
 * slots start unset and the validator lists them until the author picks them.
 */

export const numberLiteral = (value: number): Expr => ({ k: "lit", type: "number", value });
export const stringLiteral = (value: string): Expr => ({ k: "lit", type: "string", value });
export const booleanLiteral = (value: boolean): Expr => ({ k: "lit", type: "boolean", value });

/** An operand the author has not picked yet (flagged by the Ready check, shown as "choose…"). */
export const UNSET_OPERAND: Expr = { k: "var", variable: { id: UNSET_OPERAND_ID, k: "ref", kind: "variable" } };

const FIRST_REPEAT = 2;
const RANGE_END = 3;

/** Defaults of the required slots that have an obvious first value. */
const defaultSlots = (defs: readonly SlotDef[]) => Object.fromEntries(defs.flatMap(def => {
  if (def.optional) return [];
  if (def.type.kind === "choice") return [[def.name, stringLiteral(def.type.values[0] ?? "")]];
  if (def.type.kind === "value" && def.type.type === "boolean") return [[def.name, booleanLiteral(false)]];
  return [];
}));

/** Player 1 for events about units and buildings (the usual author intent), any player otherwise. */
const defaultEventPlayer = (kind: ScriptEventKind): PlayerFilter =>
  (eventDef(kind).subject === null ? { kind: "any" } : { faction: HUMAN_FACTION, kind: "slot" });

export const createEvent = (kind: ScriptEventKind): ScriptEvent =>
  ({ kind, player: defaultEventPlayer(kind), slots: defaultSlots(eventDef(kind).slots) });

export const createPredicateCondition = (pred: ScriptPredicateKind): Condition =>
  ({ args: defaultSlots(PREDICATE_CATALOG[pred].args), k: "is", pred });

export const createCondition = (kind: "compare" | "bool" | "any" | "all" | "not"): Condition => {
  switch (kind) {
    case "compare": return { a: UNSET_OPERAND, b: UNSET_OPERAND, k: "compare", op: "==" };
    case "bool": return { k: "bool", of: UNSET_OPERAND };
    case "not": return { k: "not", of: { k: "all", of: [] } };
    default: return { k: kind, of: [] };
  }
};

export const createActionStep = (op: ScriptActionKind, id: string): ScriptAction =>
  ({ args: defaultSlots(actionDef(op).args), id, k: "do", op });

/** A flow step; `runTrigger` needs a trigger to start (the first other trigger, else the step's own trigger). */
export const createFlowStep = (kind: FlowStepKind, id: string, runTarget: string): ScriptAction => {
  switch (kind) {
    case "wait": return { id, k: "wait", seconds: numberLiteral(1) };
    case "waitUntil": return { cond: { k: "all", of: [] }, id, k: "waitUntil",
      timeoutSeconds: DEFAULT_WAIT_TIMEOUT_SECONDS };
    // oxlint-disable-next-line unicorn/no-thenable -- `then` is the shared ScriptAction field of an if step
    case "if": return { cond: { k: "all", of: [] }, else: [], id, k: "if", then: [] };
    case "forEach": return { as: DEFAULT_LOOP_NAME, body: [], id, k: "forEach", max: DEFAULT_FOR_EACH_MAX,
      over: null as unknown as Extract<ScriptAction, { k: "forEach" }>["over"] };
    case "forRange": return { as: DEFAULT_LOOP_NAME, body: [], from: numberLiteral(1), id, k: "forRange",
      to: numberLiteral(RANGE_END) };
    case "repeat": return { body: [], id, k: "repeat", times: numberLiteral(FIRST_REPEAT) };
    case "runTrigger": return { checkConditions: false, id, k: "runTrigger",
      trigger: { id: runTarget, k: "ref", kind: "trigger" }, wait: false };
    case "stop": return { id, k: "stop" };
    case "comment": return { id, k: "comment", text: "" };
  }
};

/** Wraps steps in an `if` (empty condition) or a `forEach` (loop source unset). */
export const wrapSteps = (steps: readonly ScriptAction[], kind: "if" | "forEach", id: string): ScriptAction => {
  const wrapper = createFlowStep(kind, id, "");
  // oxlint-disable-next-line unicorn/no-thenable -- `then` is the shared ScriptAction field of an if step
  if (wrapper.k === "if") return { ...wrapper, then: [...steps] };
  if (wrapper.k === "forEach") return { ...wrapper, body: [...steps] };
  return wrapper;
};
