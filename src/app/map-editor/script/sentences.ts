import { resolveTranslatableText } from "../../../../../island-of-settlers-shared/src/campaign/campaign-text";
import type { ScriptEventKind } from "../../../../../island-of-settlers-shared/src/script/catalog/events";
import type { EventPhrasingKind } from "../../../../../island-of-settlers-shared/src/script/catalog/phrasings";
import { eventPhrasings } from "../../../../../island-of-settlers-shared/src/script/catalog/phrasings";
import { GERMAN, HUNGARIAN } from "./constants";
import {
  ACTION_SENTENCES, CHOICE_LABELS, CONDITION_SENTENCES, EVENT_PHRASINGS_DE, EVENT_SENTENCES, FLOW_SENTENCES,
  FUNCTION_SENTENCES,
  PREDICATE_SENTENCES, type SentencePair, SLOT_LABELS
} from "./sentences-data";

/** Sentence templates in the active language and their `{slot}` parts (design §3.3). */

export type SentenceToken = { kind: "text"; text: string } | { kind: "slot"; name: string };

/** The template of an entry in a locale (English, Hungarian or German; other locales read English). */
export const pickSentence = (pair: SentencePair, locale: string) => {
  const language = locale.split("-")[0];
  if (language === HUNGARIAN) return pair[1];
  if (language === GERMAN) return pair[2];
  return pair[0];
};

/** Splits "{player}'s {killer} kills {victim}" into text and slot tokens. */
export const parseSentence = (template: string): SentenceToken[] => {
  const tokens: SentenceToken[] = [];
  let last = 0;
  for (const match of template.matchAll(/\{(\w+)\}/g)) {
    if (match.index > last) tokens.push({ kind: "text", text: template.slice(last, match.index) });
    tokens.push({ kind: "slot", name: match[1]! });
    last = match.index + match[0].length;
  }
  if (last < template.length) tokens.push({ kind: "text", text: template.slice(last) });
  return tokens;
};

/** The slot names a template mentions. */
export const sentenceSlots = (template: string) =>
  parseSentence(template).flatMap(token => (token.kind === "slot" ? [token.name] : []));

const humanize = (name: string) => name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

const pairOr = (table: Readonly<Record<string, SentencePair>>, key: string): SentencePair =>
  table[key] ?? [humanize(key), humanize(key), humanize(key)];

/** The event template: the shared phrasing for two-actor events, else the editor table. */
export const eventSentence = (kind: ScriptEventKind, phrasing: EventPhrasingKind | undefined, locale: string) => {
  const pair = eventPhrasings(kind);
  const german = EVENT_PHRASINGS_DE[kind];
  if (german && locale.startsWith(GERMAN)) return phrasing === "inverse" ? german[1] : german[0];
  if (pair) return resolveTranslatableText(pair[phrasing ?? "primary"].sentence, locale.split("-")[0]!);
  return pickSentence(pairOr(EVENT_SENTENCES, kind), locale);
};

export const actionSentence = (op: string, locale: string) => pickSentence(pairOr(ACTION_SENTENCES, op), locale);
export const flowSentence = (kind: string, locale: string) => pickSentence(pairOr(FLOW_SENTENCES, kind), locale);
export const predicateSentence = (kind: string, locale: string) =>
  pickSentence(pairOr(PREDICATE_SENTENCES, kind), locale);
export const conditionSentence = (kind: string, locale: string) =>
  pickSentence(pairOr(CONDITION_SENTENCES, kind), locale);
export const functionSentence = (kind: string, locale: string) =>
  pickSentence(pairOr(FUNCTION_SENTENCES, kind), locale);

/** A slot's picker title word ("killer", "gyilkos"). */
export const slotLabel = (name: string, locale: string) => pickSentence(pairOr(SLOT_LABELS, name), locale);

/** A closed-list value or comparison operator in words. */
export const choiceLabel = (value: string, locale: string) => pickSentence(pairOr(CHOICE_LABELS, value), locale);

/** The sentence of a template with every slot replaced by a word (catalogue lists, "+ event" options). */
export const sentenceWithLabels = (template: string, locale: string) => parseSentence(template)
  .map(token => (token.kind === "text" ? token.text : `[${slotLabel(token.name, locale)}]`)).join("");
