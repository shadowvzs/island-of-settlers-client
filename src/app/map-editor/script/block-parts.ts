import type { AudioKind, ContentKind } from "@shared/catalog";

import type { AudioRef } from "../../../../../island-of-settlers-shared/src/script/audio";
import {
  functionDef, isScriptFunctionKind
} from "../../../../../island-of-settlers-shared/src/script/catalog/functions";
import type { SlotDef, SlotType } from "../../../../../island-of-settlers-shared/src/script/catalog/slots";
import {
  ARRAY_ELEMENT_TYPES, MAP_EDGE, MATH_OPERATORS, RESPONSE_TYPES
} from "../../../../../island-of-settlers-shared/src/script/constants";
import { isScriptRef } from "../../../../../island-of-settlers-shared/src/script/references";
import type {
  ActorLook, ActorSelector, ActorTypeRef
} from "../../../../../island-of-settlers-shared/src/script/types/actors";
import type { PlayerFilter, ScriptRefKind } from "../../../../../island-of-settlers-shared/src/script/types/refs";
import type {
  ScriptGoodsLine, ScriptSoldierLine
} from "../../../../../island-of-settlers-shared/src/script/types/rewards";
import type { UiTarget } from "../../../../../island-of-settlers-shared/src/script/types/ui";
import type {
  EventResponseKey, Expr, ValueType
} from "../../../../../island-of-settlers-shared/src/script/types/values";
import { translateMessage } from "../../../shared/i18n/translate";
import { describeAudioRef } from "./audio-picker-model";
import type { CapabilityMode } from "./catalog-options";
import {
describeActorType, describeChoice,   type DescribeContext, describeExpr, describeGoods, describeLook, describePlayer,
  describeRef, describeSelector, describeSoldiers, describeUiTarget
} from "./describe";
import { SCRIPT_MESSAGES as M } from "./messages";
import { type NodePath, pathKey } from "./paths";
import { functionSentence, parseSentence, slotLabel } from "./sentences";

/**
 * Typed sentence parts (design §13.2): text between the slots, and slot parts that know their path, their picker
 * and a summary of their value. A function or math value becomes a nested sentence inside its slot.
 */

/** A loop variable in scope: its name and value type (null: known only at run time). */
export interface LocalInfo {
  name: string;
  type: ValueType | null;
}

/** What a step or block may read: event responses of every firing, loop variables in scope. */
export interface PartScope {
  /** Inside a multiboard cell: the row context (row label, index, item, player) is readable, `random` is not. */
  cell?: boolean;
  locals: readonly LocalInfo[];
  responses: readonly EventResponseKey[];
}

export type PickerSpec =
  | { kind: "actor"; kinds?: readonly ContentKind[]; mode: CapabilityMode; requires: string | null; scope: PartScope;
    subject: boolean; tag?: string; instanceOnly?: boolean }
  | { kind: "actorType"; kinds?: readonly ContentKind[]; mode: CapabilityMode; requires: string | null }
  | { kind: "player"; allowResponse: boolean }
  | { kind: "ref"; ref: ScriptRefKind; scope: PartScope }
  | { kind: "content"; kinds: readonly ContentKind[] }
  | { kind: "value"; scope: PartScope; type: ValueType | null }
  | { kind: "choice"; values: readonly string[] }
  | { kind: "regionOrEdge"; scope: PartScope }
  | { kind: "look" }
  /** A catalog sound / music entry or an audio file uploaded with the map. */
  | { audio: AudioKind; kind: "audio" }
  | { kind: "uiTarget" }
  | { kind: "rewards" }
  | { kind: "goods" }
  | { kind: "soldiers" }
  /** A plain loop variable name (`forEach.as`). */
  | { kind: "name" }
  /** A plain number field (`waitUntil.timeoutSeconds`, `forEach.max`). */
  | { kind: "plainNumber"; nullable: boolean }
  /** A plain comment text. */
  | { kind: "plainText" };

export interface SlotPart {
  /** Nested sentence of a function or math value; null for a flat value. */
  children: BlockPart[] | null;
  key: string;
  kind: "slot";
  label: string;
  optional: boolean;
  path: NodePath;
  spec: PickerSpec;
  /** "" when not set. */
  summary: string;
  value: unknown;
}

export type BlockPart = { kind: "text"; text: string } | SlotPart;

export const EMPTY_SCOPE: PartScope = { locals: [], responses: [] };

const responsesOfType = (scope: PartScope, type: ValueType) =>
  scope.responses.filter(key => RESPONSE_TYPES[key] === type);


/** Responses of a value type (or every response when the type is open). */
export const matchingResponses = (scope: PartScope, type: ValueType | null) =>
  (type === null ? [...scope.responses] : responsesOfType(scope, type));

/** The value type of a `variableValue` slot: the named variable's type or its element type. */
const variableValueType = (
  type: Extract<SlotType, { kind: "variableValue" }>, values: Readonly<Record<string, unknown>>,
  context: DescribeContext
): ValueType | null => {
  const ref = values[type.of];
  const variable = isScriptRef(ref) ? context.script.variables.find(item => item.id === ref.id) : undefined;
  if (!variable) return null;
  const element = ARRAY_ELEMENT_TYPES[variable.type];
  const indexed = values.index !== undefined && values.index !== null;
  return element && (type.element === "always" || indexed) ? element : variable.type;
};

export interface SlotOptions {
  context: DescribeContext;
  mode: CapabilityMode;
  scope: PartScope;
  /** The event's subject slot name and capability (its owner is the event player filter). */
  subject?: { capability: string | null; name: string | null };
  /** The node holding the slot values (variable-typed slots read their variable). */
  values: Readonly<Record<string, unknown>>;
}

/** The picker of a catalogue slot. */
export const slotSpec = (def: SlotDef, options: SlotOptions): PickerSpec => {
  const { type } = def;
  const { mode, scope } = options;
  switch (type.kind) {
    case "actor": {
      const subject = options.subject?.name === def.name;
      const requires = subject ? options.subject?.capability ?? type.requires : type.requires;
      return { instanceOnly: type.instanceOnly, kind: "actor", kinds: type.kinds, mode, requires, scope, subject,
        tag: type.tag };
    }
    case "actorType": return { kind: "actorType", kinds: type.kinds, mode, requires: type.requires };
    case "player": return { allowResponse: scope.responses.includes("triggeringPlayer"), kind: "player" };
    case "ref": return { kind: "ref", ref: type.ref, scope };
    case "content": return { kind: "content", kinds: type.kinds };
    case "value": return { kind: "value", scope, type: type.type };
    case "variableValue":
      return { kind: "value", scope, type: variableValueType(type, options.values, options.context) };
    case "choice": return { kind: "choice", values: type.values };
    case "regionOrEdge": return { kind: "regionOrEdge", scope };
    case "audio": return { audio: type.audio, kind: "audio" };
    default: return { kind: type.kind } as PickerSpec;
  }
};

const isExpr = (value: unknown): value is Expr =>
  typeof value === "object" && value !== null && "k" in value && typeof (value as { k: unknown }).k === "string";

const rewardsSummary = (value: unknown, context: DescribeContext) => (Array.isArray(value) && value.length
  ? translateMessage(context.i18n, M.value.rewards, { count: value.length }) : "");

const regionOrEdgeSummary = (value: unknown, context: DescribeContext) => {
  if (isExpr(value) && value.k === "lit" && value.value === MAP_EDGE) return translateMessage(context.i18n,
    M.value.mapEdge);
  return isExpr(value) ? describeExpr(value, context) : "";
};

/** The summary of a slot value ("" when not set). */
export const summarizeValue = (spec: PickerSpec, value: unknown, context: DescribeContext): string => {
  if (value === undefined || value === null) return "";
  switch (spec.kind) {
    case "actor": return describeSelector(value as ActorSelector, context);
    case "actorType": return describeActorType(value as ActorTypeRef, context);
    case "player": return isExpr(value) && value.k !== "ref" ? describeExpr(value, context)
      : describePlayer(value as PlayerFilter, context);
    case "content": return isScriptRef(value) ? describeRef(value, context) : "";
    case "choice": return describeChoice(value, context);
    case "regionOrEdge": return regionOrEdgeSummary(value, context);
    case "look": return describeLook(value as ActorLook, context);
    case "audio": return describeAudioRef(value as AudioRef, context.audioAssets ?? [], context.i18n);
    case "uiTarget": return describeUiTarget(value as UiTarget, context);
    case "rewards": return rewardsSummary(value, context);
    case "goods": return describeGoods(value as ScriptGoodsLine[], context);
    case "soldiers": return describeSoldiers(value as ScriptSoldierLine[], context);
    case "name": case "plainText": case "plainNumber": return String(value);
    default: return isExpr(value) ? describeExpr(value, context) : "";
  }
};

/** A slot part: the value at `path` with its summary, or a nested sentence for function and math values. */
export const createSlotPart = (
  name: string, spec: PickerSpec, path: NodePath, value: unknown, optional: boolean, context: DescribeContext
): SlotPart => ({
  children: nestedParts(spec, path, value, context),
  key: pathKey(path),
  kind: "slot",
  label: slotLabel(name, context.locale),
  optional,
  path,
  spec,
  summary: summarizeValue(spec, value, context),
  value
});

const valueScope = (spec: PickerSpec) => ("scope" in spec ? spec.scope : EMPTY_SCOPE);

const functionParts = (fn: string, args: Readonly<Record<string, unknown>>, path: NodePath, scope: PartScope,
  context: DescribeContext) => {
  if (!isScriptFunctionKind(fn)) return null;
  const def = functionDef(fn);
  return sentenceParts(functionSentence(fn, context.locale), def.args, { context, mode: "query", scope,
    values: args }, [...path, "args"]);
};

const nestedParts = (spec: PickerSpec, path: NodePath, value: unknown, context: DescribeContext) => {
  if (!isExpr(value) || (spec.kind !== "value" && spec.kind !== "player" && spec.kind !== "ref")) return null;
  const scope = valueScope(spec);
  if (value.k === "fn") return functionParts(value.fn, value.args, path, scope, context);
  if (value.k !== "math") return null;
  const number: PickerSpec = { kind: "value", scope, type: "number" };
  return [
    createSlotPart("a", number, [...path, "a"], value.a, false, context), { kind: "text" as const, text: " " },
    createSlotPart("op", { kind: "choice", values: MATH_OPERATORS }, [...path, "op"],
      { k: "lit", type: "string", value: value.op }, false, context),
    { kind: "text" as const, text: " " }, createSlotPart("b", number, [...path, "b"], value.b, false, context)
  ];
};

/**
 * The slots a row offers: the `exit` slot of `endMap` only on a campaign map (`context.exits`), or while it holds
 * a value, so a stray exit on another map kind can still be seen and cleared.
 */
export const offeredSlots = (
  defs: readonly SlotDef[], values: Readonly<Record<string, unknown>>, context: DescribeContext
) => defs.filter(def => def.type.kind !== "ref" || def.type.ref !== "exit" || context.exits !== undefined ||
  (values[def.name] !== undefined && values[def.name] !== null));

/**
 * The parts of a sentence template over catalogue slots stored under `base` (`args` or `slots`). Slots the
 * template does not mention follow as "· label: [value]" so every slot stays editable.
 */
export const sentenceParts = (
  template: string, defs: readonly SlotDef[], options: SlotOptions, base: NodePath,
  special: Readonly<Record<string, BlockPart>> = {}
): BlockPart[] => {
  const byName = new Map(defs.map(def => [def.name, def]));
  const mentioned = new Set<string>();
  const slot = (def: SlotDef) => createSlotPart(def.name, slotSpec(def, options), [...base, def.name],
    options.values[def.name], def.optional, options.context);
  const parts: BlockPart[] = parseSentence(template).map(token => {
    if (token.kind === "text") return token;
    mentioned.add(token.name);
    const def = byName.get(token.name);
    if (def) return slot(def);
    return special[token.name] ?? { kind: "text", text: token.name };
  });
  for (const def of defs) {
    if (mentioned.has(def.name)) continue;
    parts.push({ kind: "text", text: ` · ${slotLabel(def.name, options.context.locale)}: ` }, slot(def));
  }
  return parts;
};
