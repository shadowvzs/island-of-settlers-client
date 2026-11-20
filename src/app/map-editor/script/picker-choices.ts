import type { I18n } from "@lingui/core";

import { resolveTranslatableText } from "../../../../../island-of-settlers-shared/src/campaign/campaign-text";
import { actorDisplayName } from "../../../../../island-of-settlers-shared/src/script/actor-names";
import type { ActorSelector, ScriptActor } from "../../../../../island-of-settlers-shared/src/script/types/actors";
import type { Expr } from "../../../../../island-of-settlers-shared/src/script/types/values";
import { translateMessage } from "../../../shared/i18n/translate";
import type { PickerSpec } from "./block-parts";
import { catalogNations } from "./catalog-options";
import { type DescribeContext, describeLook, describeUiTarget } from "./describe";
import { SCRIPT_MESSAGES as M } from "./messages";
import {
  cellChoices, functionChoices, localChoices, type PickerChoice, playerChoices, refChoices, responseChoices,
  variableChoices
} from "./picker-options";
import { choiceLabel } from "./sentences";
import { lookValues, type PickerTabId, stringValue, uiTargetValues } from "./slot-picker-model";

/**
 * The list choices of one picker tab (design §13.3): actors and actor variables, event responses, loop items,
 * players, references, closed choices, looks, UI targets, variables and functions of the slot's type.
 */

const ref = <K extends string>(kind: K, id: string) => ({ id, k: "ref" as const, kind });

/** An actor in the picker: its editor label, with the name players read when it has one. */
const actorChoiceLabel = (actor: ScriptActor, context: DescribeContext) => {
  const displayName = actorDisplayName(actor);
  if (!displayName) return actor.name;
  return translateMessage(context.i18n, M.actors.shownAs,
    { displayName: resolveTranslatableText(displayName, context.locale), name: actor.name });
};

const actorInstanceChoices = (context: DescribeContext): PickerChoice<ActorSelector>[] => [
  ...context.script.actors.map(actor => ({ key: `actor:${actor.id}`, label: actorChoiceLabel(actor, context),
    value: { actor: ref("actor", actor.id), kind: "instance" as const } })),
  ...context.script.variables.filter(item => item.type === "actor" || item.type === "actorGroup")
    .map(item => ({ key: `variable:${item.id}`, label: `${item.name} (${item.type})`,
      value: { kind: "variable" as const, variable: ref("variable", item.id) } }))
];

const actorResponseChoices = (spec: Extract<PickerSpec, { kind: "actor" }>, context: DescribeContext) =>
  responseChoices(spec.scope, "actor", context).map(choice => ({ ...choice,
    value: { key: (choice.value as Extract<Expr, { k: "resp" }>).key, kind: "response" } as ActorSelector }));

const actorLocalChoices = (spec: Extract<PickerSpec, { kind: "actor" }>) => localChoices(spec.scope, "actor")
  .map(choice => ({ ...choice, value: { kind: "local", name: choice.key } as ActorSelector }));

const MAP_EDGE_VALUE = stringValue("mapEdge");

/** Reference kinds an event response may fill (the event's region, quest or timer). */
const REF_RESPONSE_TYPES: Partial<Record<string, "quest" | "region" | "timer">> = {
  quest: "quest", region: "region", timer: "timer"
};

const listChoices = (spec: PickerSpec, context: DescribeContext): PickerChoice[] => {
  const { i18n } = context;
  switch (spec.kind) {
    case "player": return playerChoices(spec.allowResponse, context);
    case "ref": {
      const responseType = REF_RESPONSE_TYPES[spec.ref];
      const responses = responseType ? responseChoices(spec.scope, responseType, context) : [];
      return [...refChoices(spec.ref, context), ...responses];
    }
    case "regionOrEdge": return [{ key: "mapEdge", label: translateMessage(i18n, M.value.mapEdge),
      value: MAP_EDGE_VALUE }, ...refChoices("region", context)];
    case "choice": return spec.values.map(value => ({ key: value, label: choiceLabel(value, context.locale),
      value: stringValue(value) }));
    case "look": return lookValues(catalogNations(i18n).map(nation => nation.key))
      .map(look => ({ key: JSON.stringify(look), label: describeLook(look, context), value: look }));
    case "uiTarget": return uiTargetValues().map(target => ({ key: JSON.stringify(target),
      label: `${describeUiTarget(target, context)}${"view" in target ? ` (${target.view})` : ""}`, value: target }));
    case "value": return valueListChoices(spec, context);
    default: return [];
  }
};


const valueListChoices = (spec: Extract<PickerSpec, { kind: "value" }>, context: DescribeContext): PickerChoice[] => {
  const { i18n } = context;
  if (spec.type === "boolean") return [true, false].map(value => ({ key: String(value),
    label: translateMessage(i18n, value ? M.value.yes : M.value.no), value: { k: "lit", type: "boolean", value } }));
  if (spec.type === "player") return playerChoices(spec.scope.responses.includes("triggeringPlayer"), context);
  if (spec.type === "region" || spec.type === "quest" || spec.type === "timer" || spec.type === "multiboard")
    return [...refChoices(spec.type, context), ...responseChoices(spec.scope, spec.type, context)];
  return [];
};

const scopeOf = (spec: PickerSpec) => ("scope" in spec ? spec.scope : { locals: [], responses: [] });
const typeOf = (spec: PickerSpec) => (spec.kind === "value" ? spec.type : null);

/** The choices of a list-like tab; an empty list for panel tabs (catalog, family, inputs). */
export const tabChoices = (tab: PickerTabId, spec: PickerSpec, context: DescribeContext): PickerChoice[] => {
  if (spec.kind === "actor") {
    if (tab === "instance") return actorInstanceChoices(context);
    if (tab === "response") return actorResponseChoices(spec, context);
    if (tab === "local") return actorLocalChoices(spec);
    return [];
  }
  switch (tab) {
    case "list": return listChoices(spec, context);
    case "variable": return variableChoices(typeOf(spec), context);
    case "response": return responseChoices(scopeOf(spec), typeOf(spec), context);
    case "local": return localChoices(scopeOf(spec), typeOf(spec));
    case "function": return functionChoices(typeOf(spec), context, scopeOf(spec).cell === true);
    case "cell": return cellChoices(typeOf(spec), context);
    default: return [];
  }
};

/** Tab names of the picker. */
export const tabLabel = (tab: PickerTabId, i18n: I18n | undefined) => translateMessage(i18n, {
  audio: M.picker.tabValue, cell: M.picker.tabCell, family: M.picker.tabFamily, function: M.picker.tabFunction, goods: M.picker.tabValue,
  instance: M.picker.tabInstance,
  list: M.picker.tabValue, local: M.picker.tabLocal, math: M.picker.tabMath, response: M.picker.tabResponse,
  rewards: M.picker.tabValue, soldiers: M.picker.tabValue, type: M.picker.tabType, value: M.picker.tabValue,
  variable: M.picker.tabVariable
}[tab]);
