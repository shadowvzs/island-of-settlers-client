import type { I18n } from "@lingui/core";

import { CAMPAIGN_DEFAULT_EXIT } from "../../../../../island-of-settlers-shared/src/campaign/campaign-constants";
import type { CampaignMapExit } from "../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import { resolveTranslatableText } from "../../../../../island-of-settlers-shared/src/campaign/campaign-text";
import type { MapAudioAsset } from "../../../../../island-of-settlers-shared/src/script/audio";
import { isScriptRef } from "../../../../../island-of-settlers-shared/src/script/references";
import type {
  ActorLook, ActorQueryPick, ActorSelector, ActorTypeRef
} from "../../../../../island-of-settlers-shared/src/script/types/actors";
import type { QuestText } from "../../../../../island-of-settlers-shared/src/script/types/quest-text";
import type { PlayerFilter, ScriptRef } from "../../../../../island-of-settlers-shared/src/script/types/refs";
import type {
  ScriptGoodsLine, ScriptSoldierLine
} from "../../../../../island-of-settlers-shared/src/script/types/rewards";
import type { MapScript } from "../../../../../island-of-settlers-shared/src/script/types/script";
import type { UiTarget } from "../../../../../island-of-settlers-shared/src/script/types/ui";
import type {
  CellContextKey, EventResponseKey, Expr
} from "../../../../../island-of-settlers-shared/src/script/types/values";
import { translateMessage } from "../../../shared/i18n/translate";
import { contentName, familyLabel, familyMembers } from "./catalog-options";
import { UNSET_OPERAND_ID } from "./constants";
import { SCRIPT_MESSAGES as M } from "./messages";
import { choiceLabel } from "./sentences";

/** Plain-language summaries of slot values for the sentence blocks and the explain line (design §13.2). */

/** An exit `endMap` may name, with its display name. */
export interface ScriptExitOption {
  id: string;
  name: string;
}

export interface DescribeContext {
  /** Audio uploaded with the map (names of `upload` audio references). */
  audioAssets?: readonly MapAudioAsset[];
  /** The exits of the campaign map (the implicit one first); absent: not a campaign map, the exit slot is hidden. */
  exits?: readonly ScriptExitOption[];
  i18n?: I18n;
  locale: string;
  script: MapScript;
}

const text = (context: DescribeContext, descriptor: Parameters<typeof translateMessage>[1],
  values?: Record<string, string | number>) => translateMessage(context.i18n, descriptor, values);

const language = (context: Pick<DescribeContext, "locale">) => context.locale.split("-")[0] ?? "en";

/**
 * The exits a campaign map's `endMap` may name (BR2): the implicit exit (shown as the outcome word "victory"), then
 * the record's declared exits by their name in the active language (the id while a name is empty).
 */
export const scriptExitOptions = (declared: readonly CampaignMapExit[], locale: string): ScriptExitOption[] => [
  { id: CAMPAIGN_DEFAULT_EXIT, name: choiceLabel(CAMPAIGN_DEFAULT_EXIT, locale) },
  ...declared.map(exit => ({ id: exit.id, name: resolveTranslatableText(exit.name, language({ locale })).trim() ||
    exit.id }))
];

/** "Player 1" is faction 0 (design §4.2). */
export const playerNumber = (faction: number) => faction + 1;

export const describePlayer = (filter: PlayerFilter, context: DescribeContext): string => {
  switch (filter.kind) {
    case "any": return text(context, M.players.any);
    case "slot": return text(context, M.players.slot, { number: playerNumber(filter.faction) });
    case "alliesOf": return text(context, filter.includeSelf ? M.players.alliesOfSelf : M.players.alliesOf,
      { number: playerNumber(filter.faction) });
    case "enemiesOf": return text(context, M.players.enemiesOf, { number: playerNumber(filter.faction) });
    case "neutral": return text(context, M.players.neutral);
    case "humans": return text(context, M.players.humans);
    case "computers": return text(context, M.players.computers);
    case "response": return text(context, M.players.response);
  }
};

export const describeResponse = (key: EventResponseKey, context: DescribeContext) =>
  text(context, M.responses[key]);

/** A script text in the active language (English when that one is missing). */
export const questTextIn = (value: QuestText, context: DescribeContext) => {
  const translated = value[language(context)];
  return typeof translated === "string" && translated.trim() ? translated : value.en;
};

const questTitle = (context: DescribeContext, id: string) => {
  const quest = context.script.quests.quests.find(item => item.id === id);
  return quest?.title ? questTextIn(quest.title, context) : id;
};

const variableName = (context: DescribeContext, id: string) =>
  context.script.variables.find(item => item.id === id)?.name ?? text(context, M.value.unknown, { id });

/** The name of what a reference points at (actor/region/trigger names, quest titles, catalog names). */
export const describeRef = (ref: ScriptRef, context: DescribeContext): string => {
  const { script } = context;
  switch (ref.kind) {
    case "actor": return script.actors.find(item => item.id === ref.id)?.name ?? ref.id;
    case "content": return contentName(context.i18n, ref.id);
    case "exit": return context.exits?.find(item => item.id === ref.id)?.name ?? ref.id;
    case "family": return text(context, M.value.family, { name: familyLabel(ref.id, context.i18n) });
    case "folder": return script.folders.find(item => item.id === ref.id)?.name ?? ref.id;
    case "multiboard": case "timer": case "variable": return variableName(context, ref.id);
    case "quest": return questTitle(context, ref.id);
    case "region": return script.regions.find(item => item.id === ref.id)?.name ?? ref.id;
    case "reward": return script.homeRewards.find(item => item.id === ref.id)?.name ?? ref.id;
    case "sequence": return script.sequences.find(item => item.id === ref.id)?.id ?? ref.id;
    case "trigger": return script.triggers.find(item => item.id === ref.id)?.name ?? ref.id;
    default: return ref.id;
  }
};

export const describeActorType = (type: ActorTypeRef, context: DescribeContext) => {
  const name = contentName(context.i18n, type.type.id);
  const ranked = type.rank?.min !== undefined && type.rank.min === type.rank.max
    ? text(context, M.value.rank, { rank: type.rank.min, type: name }) : name;
  if (!type.nation) return ranked;
  return text(context, M.value.nationType, { nation: type.nation, type: ranked });
};

const PICK_MESSAGES: Record<ActorQueryPick["kind"], typeof M.value.pickAll> = {
  all: M.value.pickAll, first: M.value.pickFirst, nearest: M.value.pickNearest, random: M.value.pickRandom
};

const withFilters = (selector: Extract<ActorSelector, { kind: "type" | "family" }>, base: string,
  context: DescribeContext) => {
  const owned = selector.owner
    ? text(context, M.value.typeOwned, { owner: describePlayer(selector.owner, context), type: base }) : base;
  if (!selector.region) return owned;
  return text(context, M.value.inRegion, { actor: owned, region: describeRef(selector.region, context) });
};

export const describeSelector = (selector: ActorSelector, context: DescribeContext): string => {
  switch (selector.kind) {
    case "instance": return describeRef(selector.actor, context);
    case "variable": return variableName(context, selector.variable.id);
    case "type": return withFilters(selector, describeActorType(selector.type, context), context);
    case "family": {
      const members = familyMembers(selector.family.id, context.i18n);
      const name = text(context, M.value.familyMembers,
        { members, name: familyLabel(selector.family.id, context.i18n) });
      return withFilters(selector, name, context);
    }
    case "response": return describeResponse(selector.key, context);
    case "local": return selector.name;
    case "query": return text(context, M.value.query, { from: describeSelector(selector.query.from, context),
      pick: text(context, PICK_MESSAGES[selector.query.pick.kind]) });
  }
};

export const describeQuestText = (value: QuestText, context: DescribeContext) =>
  `“${questTextIn(value, context)}”`;

const describeLiteral = (expr: Extract<Expr, { k: "lit" }>, context: DescribeContext) => {
  if (expr.type === "boolean") return text(context, expr.value ? M.value.yes : M.value.no);
  if (expr.type === "number") return String(expr.value);
  return `“${String(expr.value)}”`;
};

/** A multiboard cell's row context ("row label"). */
export const describeCell = (key: CellContextKey, context: DescribeContext) => text(context, M.picker.cell[key]);

/** A flat summary of an expression; nested functions and math are shown as their own sentence parts instead. */
export const describeExpr = (expr: Expr, context: DescribeContext): string => {
  if (isScriptRef(expr)) return describeRef(expr, context);
  switch (expr.k) {
    case "lit": return describeLiteral(expr, context);
    case "var": {
      if (expr.variable.id === UNSET_OPERAND_ID) return "";
      const name = variableName(context, expr.variable.id);
      return expr.index ? text(context, M.value.variableItem, { index: describeExpr(expr.index, context),
        variable: name }) : name;
    }
    case "resp": return describeResponse(expr.key, context);
    case "local": return expr.name;
    case "cell": return describeCell(expr.key, context);
    case "text": return describeQuestText(expr.text, context);
    case "list": return `[${expr.items.map(item => describeExpr(item, context)).join(", ")}]`;
    case "math": return `${describeExpr(expr.a, context)} ${expr.op} ${describeExpr(expr.b, context)}`;
    case "round": return `${text(context, M.value.round, { mode: expr.mode })} ${describeExpr(expr.of, context)}`;
    case "fn": return expr.fn;
    default: return "";
  }
};

export const describeLook = (look: ActorLook, context: DescribeContext) => {
  if (look.kind === "nation") return text(context, M.looks.nation, { nation: contentName(context.i18n,
    `nation:${look.nation}`) });
  return text(context, M.looks[look.kind]);
};

export const describeUiTarget = (target: UiTarget, context: DescribeContext) => text(context, M.uiTargets[target.kind]);

export const describeGoods = (lines: readonly ScriptGoodsLine[], context: DescribeContext) => lines
  .map(line => text(context, M.value.lineAmount, { amount: line.amount,
    name: contentName(context.i18n, `ware:${line.ware}`) })).join(", ");

export const describeSoldiers = (lines: readonly ScriptSoldierLine[], context: DescribeContext) => lines
  .map(line => text(context, M.value.lineAmount, { amount: line.amount,
    name: contentName(context.i18n, line.type.id) })).join(", ");

/** A choice literal (`{ k: "lit", type: "string" }`) in words. */
export const describeChoice = (value: unknown, context: DescribeContext) => {
  const literal = (value as { value?: unknown } | null)?.value;
  return typeof literal === "string" ? choiceLabel(literal, context.locale) : "";
};
