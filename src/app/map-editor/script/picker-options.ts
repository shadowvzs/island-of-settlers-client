import { FUNCTION_CATALOG } from "../../../../../island-of-settlers-shared/src/script/catalog/functions";
import { CELL_CONTEXT_TYPES } from "../../../../../island-of-settlers-shared/src/script/constants";
import type { PlayerFilter, ScriptRefKind } from "../../../../../island-of-settlers-shared/src/script/types/refs";
import type { ScriptVariable } from "../../../../../island-of-settlers-shared/src/script/types/script";
import type {
  CellContextKey, EventResponseKey, Expr, ScriptFunctionKind, ValueType
} from "../../../../../island-of-settlers-shared/src/script/types/values";
import { matchingResponses, type PartScope } from "./block-parts";
import { PLAYER_SLOTS_OFFERED } from "./constants";
import { describeCell, type DescribeContext, describePlayer, describeRef, describeResponse } from "./describe";
import { functionSentence, sentenceWithLabels } from "./sentences";

/**
 * Choices of the typed slot picker (design §13.3): only values of the slot's type are offered, so impossible
 * choices never appear. Pure: every option carries the value it stores.
 */

export interface PickerChoice<T = unknown> {
  key: string;
  label: string;
  value: T;
}

const ref = (kind: ScriptRefKind, id: string) => ({ id, k: "ref" as const, kind });

/** The player filters: any, each slot, allies/enemies of Player 1, nobody, humans, computers, the event's player. */
export const playerChoices = (allowResponse: boolean, context: DescribeContext): PickerChoice<PlayerFilter>[] => {
  const filters: PlayerFilter[] = [
    { kind: "any" },
    ...Array.from({ length: PLAYER_SLOTS_OFFERED }, (_, faction) => ({ faction, kind: "slot" as const })),
    { faction: 0, includeSelf: false, kind: "alliesOf" }, { faction: 0, kind: "enemiesOf" }, { kind: "neutral" },
    { kind: "humans" }, { kind: "computers" },
    ...(allowResponse ? [{ key: "triggeringPlayer", kind: "response" } as const] : [])
  ];
  return filters.map(filter => ({ key: JSON.stringify(filter), label: describePlayer(filter, context),
    value: filter }));
};

/** Variable types a reference kind accepts (multiboard and timer variables are their own kinds). */
const REF_VARIABLE_TYPES: Partial<Record<ScriptRefKind, ValueType>> = { multiboard: "multiboard", timer: "timer" };

const variablesOf = (variables: readonly ScriptVariable[], type: ValueType | null) =>
  variables.filter(item => type === null || item.type === type ||
    (type === "actorGroup" && item.type === "actor"));

/** The script items a reference slot may name. */
export const refChoices = (kind: ScriptRefKind, context: DescribeContext): PickerChoice[] => {
  const { script } = context;
  const variableType = REF_VARIABLE_TYPES[kind];
  const items: readonly { id: string }[] = (() => {
    switch (kind) {
      case "region": return script.regions;
      case "quest": return script.quests.quests;
      case "trigger": return script.triggers;
      case "variable": return script.variables;
      case "sequence": return script.sequences;
      case "reward": return script.homeRewards;
      case "actor": return script.actors;
      case "exit": return context.exits ?? [];
      case "multiboard": case "timer": return variablesOf(script.variables, variableType ?? null);
      default: return [];
    }
  })();
  return items.map(item => ({ key: item.id, label: describeRef(ref(kind, item.id), context), value: ref(kind,
    item.id) }));
};

/** Responses as expression values of a type. */
export const responseChoices = (scope: PartScope, type: ValueType | null, context: DescribeContext):
  PickerChoice<Expr>[] => matchingResponses(scope, type).map((key: EventResponseKey) => ({
  key, label: describeResponse(key, context), value: { k: "resp", key }
}));

/** Variables of a value type as `var` expressions. */
export const variableChoices = (type: ValueType | null, context: DescribeContext): PickerChoice<Expr>[] =>
  variablesOf(context.script.variables, type).map(item => ({
    key: item.id, label: `${item.name} (${item.type})`, value: { k: "var", variable: ref("variable", item.id) } as Expr
  }));

/** The row context of a multiboard cell whose type fits the slot (`rowItem` is typed at run time). */
export const cellChoices = (type: ValueType | null, context: DescribeContext): PickerChoice<Expr>[] =>
  (Object.keys(CELL_CONTEXT_TYPES) as CellContextKey[])
    .filter(key => type === null || CELL_CONTEXT_TYPES[key] === null || CELL_CONTEXT_TYPES[key] === type)
    .map(key => ({ key, label: describeCell(key, context), value: { k: "cell", key } }));

/** Loop variables in scope of a type. */
export const localChoices = (scope: PartScope, type: ValueType | null): PickerChoice<Expr>[] => scope.locals
  .filter(local => type === null || local.type === null || local.type === type)
  .map(local => ({ key: local.name, label: local.name, value: { k: "local", name: local.name } }));

/**
 * World functions whose result fits the slot (scalars only for an open-typed comparison operand); a board cell
 * never offers `random` (it would advance the saved random stream).
 */
export const functionChoices = (type: ValueType | null, context: DescribeContext, cell = false):
  PickerChoice<Expr>[] => (Object.keys(FUNCTION_CATALOG) as ScriptFunctionKind[])
    .filter(fn => !(cell && fn === "random"))
    .filter(fn => (type === null ? ["number", "string", "boolean"].includes(FUNCTION_CATALOG[fn].result)
      : FUNCTION_CATALOG[fn].result === type || (type === "text" && FUNCTION_CATALOG[fn].result === "text")))
    .map(fn => ({ key: fn, label: sentenceWithLabels(functionSentence(fn, context.locale), context.locale),
      value: { args: {}, fn, k: "fn" } }));
