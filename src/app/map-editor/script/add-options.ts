import { actionDef, type ScriptActionKind } from "../../../../../island-of-settlers-shared/src/script/catalog/actions";
import { eventDef, type ScriptEventKind } from "../../../../../island-of-settlers-shared/src/script/catalog/events";
import {
  PREDICATE_CATALOG, type ScriptPredicateKind
} from "../../../../../island-of-settlers-shared/src/script/catalog/predicates";
import { isActionAllowed, isEventAllowed } from "../../../../../island-of-settlers-shared/src/script/scopes";
import type { MapKind } from "../../../../../island-of-settlers-shared/src/script/types/refs";
import { foldSearchText } from "../reward-picker/catalog";
import {
  ACTION_GROUPS, type ActionGroupId, CONDITION_ROW_KINDS, EVENT_GROUPS, type EventGroupId, FLOW_STEP_KINDS
} from "./constants";
import {
  actionSentence, conditionSentence, eventSentence, flowSentence, predicateSentence, sentenceWithLabels
} from "./sentences";

/**
 * The "+ event", "+ condition" and "+ action" lists (design §13.2): catalogue entries grouped like the design's
 * sections, worded as sentences with slot words, filtered by the map kind's scope and a search; entries of later
 * lanes carry their lane ("later (TRG3c)") but stay choosable, as the validator only warns about them.
 */

export type AddKind = "event" | "condition" | "action";

export interface AddOption {
  /** The lane that must land before it runs; "" when it runs now. */
  later: string;
  /** `event:<kind>`, `predicate:<kind>`, `row:<kind>`, `action:<op>`, `flow:<kind>`. */
  key: string;
  label: string;
}

export interface AddGroup {
  id: string;
  options: AddOption[];
}

const laterOf = (def: { pending?: string; since: number }) => def.pending ?? (def.since > 1 ? "v2" : "");

const eventGroups = (mapKind: MapKind, locale: string): AddGroup[] =>
  (Object.keys(EVENT_GROUPS) as EventGroupId[]).map(id => ({
    id,
    options: (EVENT_GROUPS[id] as readonly ScriptEventKind[]).filter(kind => isEventAllowed(mapKind, kind))
      .map(kind => ({ key: `event:${kind}`, label: sentenceWithLabels(eventSentence(kind, "primary", locale), locale),
        later: laterOf(eventDef(kind)) }))
  }));

const conditionGroups = (locale: string): AddGroup[] => [
  { id: "rows", options: CONDITION_ROW_KINDS.map(kind => ({ key: `row:${kind}`, later: "",
    label: sentenceWithLabels(conditionSentence(kind, locale), locale) })) },
  { id: "predicates", options: (Object.keys(PREDICATE_CATALOG) as ScriptPredicateKind[]).map(kind => ({
    key: `predicate:${kind}`, later: "", label: sentenceWithLabels(predicateSentence(kind, locale), locale) })) }
];

const actionGroups = (mapKind: MapKind, locale: string): AddGroup[] => [
  { id: "flow", options: FLOW_STEP_KINDS.map(kind => ({ key: `flow:${kind}`, later: "",
    label: sentenceWithLabels(flowSentence(kind, locale), locale).replace("[condition]", "…") })) },
  ...(Object.keys(ACTION_GROUPS) as ActionGroupId[]).map(id => ({
    id,
    options: (ACTION_GROUPS[id] as readonly ScriptActionKind[]).filter(op => isActionAllowed(mapKind, op))
      .map(op => ({ key: `action:${op}`, label: sentenceWithLabels(actionSentence(op, locale), locale),
        later: laterOf(actionDef(op)) }))
  }))
];

/** The groups of an add list, each option matching every word of the query; empty groups dropped. */
export const addGroups = (kind: AddKind, mapKind: MapKind, locale: string, query: string): AddGroup[] => {
  const groups = { action: () => actionGroups(mapKind, locale), condition: () => conditionGroups(locale),
    event: () => eventGroups(mapKind, locale) }[kind]();
  const words = foldSearchText(query).split(/\s+/).filter(Boolean);
  return groups.map(group => ({ ...group, options: group.options.filter(option => {
    const text = foldSearchText(`${option.label} ${option.key}`);
    return words.every(word => text.includes(word));
  }) })).filter(group => group.options.length > 0);
};
