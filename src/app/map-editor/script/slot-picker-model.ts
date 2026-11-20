import type { ContentKind } from "@shared/catalog";

import type { ActorLook, ActorSelector } from "../../../../../island-of-settlers-shared/src/script/types/actors";
import type { QuestText } from "../../../../../island-of-settlers-shared/src/script/types/quest-text";
import type { PlayerFilter } from "../../../../../island-of-settlers-shared/src/script/types/refs";
import type {
  ScriptGoodsLine, ScriptSoldierLine
} from "../../../../../island-of-settlers-shared/src/script/types/rewards";
import type { MainPanelView, UiTarget } from "../../../../../island-of-settlers-shared/src/script/types/ui";
import type { Expr, ValueType } from "../../../../../island-of-settlers-shared/src/script/types/values";
import type { RewardEntry } from "../../settlement-ui/reward-icons/entries";
import type { PickerSpec } from "./block-parts";
import type { CatalogFilter } from "./catalog-options";
import { SPECIAL_LOOKS } from "./constants";

/**
 * The slot picker's pure model (design §13.3): which tabs a slot type offers, which tab the current value opens
 * on, and the conversions between picker choices and stored values.
 */

export type PickerTabId =
  | "instance" | "type" | "family" | "response" | "local" | "value" | "variable" | "function" | "math" | "list"
  | "rewards" | "goods" | "soldiers" | "cell" | "audio";

const VALUE_TABS: Readonly<Partial<Record<ValueType, readonly PickerTabId[]>>> = {
  boolean: ["list", "variable", "function"],
  number: ["value", "variable", "response", "local", "function", "math"],
  string: ["value", "variable", "response", "local", "function"],
  text: ["value", "variable", "function"],
  ware: ["type", "response"],
  actorType: ["type"],
  player: ["list"],
  region: ["list"], quest: ["list"], timer: ["list"], multiboard: ["list"],
  actor: ["instance", "response", "local"], actorGroup: ["instance", "response", "local"],
  "number[]": ["variable"], "string[]": ["variable"]
};
const OPEN_VALUE_TABS: readonly PickerTabId[] = ["value", "variable", "response", "local", "function"];

/** Tabs a multiboard cell has no use for: a cell runs outside any event and loop. */
const NOT_IN_CELLS: ReadonlySet<PickerTabId> = new Set(["response", "local"]);

/** A multiboard cell slot reads its row instead of an event or a loop (design §4.11). */
const withCellTab = (spec: Extract<PickerSpec, { kind: "value" }>, tabs: readonly PickerTabId[]) =>
  (spec.scope.cell ? [...tabs.filter(tab => !NOT_IN_CELLS.has(tab)), "cell" as const] : tabs);

/** The tabs a slot offers, in order. */
export const pickerTabs = (spec: PickerSpec): readonly PickerTabId[] => {
  switch (spec.kind) {
    case "actor": return spec.instanceOnly ? ["instance", "response", "local"]
      : ["instance", "type", "family", "response", "local"];
    case "actorType": case "content": return ["type"];
    case "value":
      return withCellTab(spec, spec.type === null ? OPEN_VALUE_TABS : VALUE_TABS[spec.type] ?? ["value"]);
    case "audio": return ["audio"];
    case "rewards": return ["rewards"];
    case "goods": return ["goods"];
    case "soldiers": return ["soldiers"];
    case "name": case "plainText": case "plainNumber": return ["value"];
    default: return ["list"];
  }
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const SELECTOR_TABS: Readonly<Record<string, PickerTabId>> = {
  family: "family", instance: "instance", local: "local", query: "instance", response: "response", type: "type",
  variable: "instance"
};
const EXPR_TABS: Readonly<Record<string, PickerTabId>> = {
  cell: "cell", fn: "function", lit: "value", local: "local", math: "math", ref: "type", resp: "response",
  text: "value", var: "variable"
};

/** The tab the current value belongs to (the first tab when unset or not offered). */
export const initialPickerTab = (spec: PickerSpec, value: unknown): PickerTabId => {
  const tabs = pickerTabs(spec);
  let tab: PickerTabId | undefined;
  if (spec.kind === "actor" && isObject(value)) tab = SELECTOR_TABS[String(value.kind)];
  else if (spec.kind === "value" && isObject(value)) tab = EXPR_TABS[String(value.k)];
  if (spec.kind === "value" && spec.type === "boolean" && tab === "value") tab = "list";
  return tab && tabs.includes(tab) ? tab : tabs[0]!;
};

/** The catalog filter of a type tab (actor, actor type, content, ware). */
export const pickerCatalogFilter = (spec: PickerSpec): CatalogFilter => {
  if (spec.kind === "actor") return { kinds: spec.kinds, mode: spec.mode, requires: spec.requires, tag: spec.tag };
  if (spec.kind === "actorType") return { kinds: spec.kinds, mode: spec.mode, requires: spec.requires };
  if (spec.kind === "content") return { kinds: spec.kinds, mode: "query", requires: null };
  const kinds: readonly ContentKind[] | undefined = spec.kind === "value" && spec.type === "ware" ? ["ware"]
    : undefined;
  return { kinds, mode: "query", requires: null };
};

export interface TypeChoice {
  id: string;
  nation?: string;
  rank?: number;
}

/** The stored value of a picked catalog type for the slot. */
export const typeValue = (spec: PickerSpec, choice: TypeChoice, filters: SelectorFilters): unknown => {
  const type = { ...(choice.nation ? { nation: choice.nation } : {}),
    ...(choice.rank === undefined ? {} : { rank: { max: choice.rank, min: choice.rank } }),
    type: { id: choice.id, k: "ref" as const, kind: "content" as const } };
  if (spec.kind === "actorType") return type;
  if (spec.kind === "actor") return withSelectorFilters({ kind: "type", type }, spec, filters);
  return type.type;
};

export interface SelectorFilters {
  owner: PlayerFilter;
  region: string | null;
}

/** Owner (outside an event subject, required by the validator) and region filters of a type/family selector. */
export const withSelectorFilters = (
  selector: Extract<ActorSelector, { kind: "type" | "family" }>, spec: PickerSpec, filters: SelectorFilters
): ActorSelector => {
  const subject = spec.kind === "actor" && spec.subject;
  return {
    ...selector,
    ...(subject ? {} : { owner: filters.owner }),
    ...(filters.region ? { region: { id: filters.region, k: "ref", kind: "region" } } : {})
  } as ActorSelector;
};

/** The filters a type/family value already carries (to keep them when the picker reopens). */
export const selectorFilters = (value: unknown): SelectorFilters => {
  const selector = isObject(value) ? value : {};
  const region = isObject(selector.region) ? String(selector.region.id) : null;
  return { owner: (selector.owner as PlayerFilter | undefined) ?? { kind: "any" }, region };
};

export const numberValue = (value: number): Expr => ({ k: "lit", type: "number", value });
export const stringValue = (value: string): Expr => ({ k: "lit", type: "string", value });
export const textValue = (text: QuestText): Expr => ({ k: "text", text });

/** A math node around the current number value. */
export const mathValue = (current: unknown): Expr => ({
  a: isObject(current) && typeof current.k === "string" ? current as Expr : numberValue(0), b: numberValue(1),
  k: "math", op: "+"
});

/** Looks offered for a spawned unit: the owner's nation, each catalog nation, pirates and bandits (owner 19). */
export const lookValues = (nations: readonly string[]): ActorLook[] => [
  { kind: "ownerNation" }, ...nations.map(nation => ({ kind: "nation" as const, nation })),
  ...SPECIAL_LOOKS.map(kind => ({ kind }))
];

const MAIN_PANEL_VIEWS: readonly MainPanelView[] = ["build", "menu", "notices", "ships"];
const SIMPLE_UI_TARGETS = ["inventory", "quests", "settings", "language", "overview", "messages", "talents", "market",
  "tradeOffice", "fleet", "expeditionPlanner", "colonyTracker", "terrainSurvey", "gemShop"] as const;

/** UI targets without required parameters, and the main panel per view (a building target needs an actor). */
export const uiTargetValues = (): UiTarget[] => [
  ...SIMPLE_UI_TARGETS.map(kind => ({ kind }) as UiTarget),
  ...MAIN_PANEL_VIEWS.map(view => ({ kind: "mainPanel" as const, view }))
];

/** Goods lines ↔ reward picker ware entries. */
export const goodsToEntries = (value: unknown): RewardEntry[] => (Array.isArray(value) ? value as ScriptGoodsLine[]
  : []).map(line => ({ amount: line.amount, kind: "ware", ware: line.ware }));
export const entriesToGoods = (entries: readonly RewardEntry[]): ScriptGoodsLine[] => entries
  .flatMap(entry => (entry.kind === "ware" ? [{ amount: entry.amount, ware: entry.ware }] : []));

const SOLDIER_PREFIX = "soldier:";

/** Soldier lines ↔ reward picker soldier entries (settler entries are not soldiers and are dropped). */
export const soldiersToEntries = (value: unknown): RewardEntry[] => (Array.isArray(value)
  ? value as ScriptSoldierLine[] : []).map(line => ({ amount: line.amount, kind: "soldier", rank: line.rank,
  soldierType: line.type.id.slice(SOLDIER_PREFIX.length) }) as RewardEntry);
export const entriesToSoldiers = (entries: readonly RewardEntry[]): ScriptSoldierLine[] => entries
  .flatMap(entry => (entry.kind === "soldier" ? [{ amount: entry.amount, ...(entry.rank === undefined ? {}
    : { rank: entry.rank }), type: { id: `${SOLDIER_PREFIX}${entry.soldierType}`, k: "ref" as const,
    kind: "content" as const } }] : []));
