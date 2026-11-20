import { useLingui } from "@lingui/react";
import { getContentEntry, type VariantAxes } from "@shared/catalog";
import { useMemo, useState } from "react";

import type { QuestText } from "../../../../../island-of-settlers-shared/src/script/types/quest-text";
import { translateMessage } from "../../../shared/i18n/translate";
import type { RewardEntry } from "../../settlement-ui/reward-icons/entries";
import type { RewardPickerTab } from "../reward-picker/constants";
import type { PickerSpec } from "./block-parts";
import { catalogNations, catalogTabs, familyTree, filterCatalogOptions } from "./catalog-options";
import type { CatalogTabId } from "./constants";
import { SCRIPT_MESSAGES as M } from "./messages";
import {
  entriesToGoods, entriesToSoldiers, goodsToEntries, mathValue, numberValue, pickerCatalogFilter, type SelectorFilters,
soldiersToEntries,
  stringValue, textValue, typeValue} from "./slot-picker-model";
import { EMPTY_TEXT, textLanguageRows, withTextLanguage } from "./text-fields";

const DEFAULT_NATION = "roman";
const SOLDIER_RANKS = [0, 1, 2] as const;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** The content id a type value holds (selector, type ref or content ref). */
const typeIdOf = (value: unknown): string => {
  if (!isObject(value)) return "";
  if (value.k === "ref") return String(value.id);
  const type = isObject(value.type) ? value.type : value;
  return isObject(type.type) ? String(type.type.id) : "";
};

/** Catalog tab of the picker: kind tabs, search, nation (for nation-styled entries) and soldier rank. */
export const useCatalogPanel = (spec: PickerSpec, value: unknown, filters: SelectorFilters,
  onChoose: (value: unknown) => void) => {
  const { i18n } = useLingui();
  const [query, setQuery] = useState("");
  const [nation, setNation] = useState("");
  const [rank, setRank] = useState("");
  const { locale } = i18n;
  const tabs = useMemo(() => catalogTabs(pickerCatalogFilter(spec), { i18n, locale }, nation || DEFAULT_NATION),
    [spec, i18n, locale, nation]);
  const selectedId = typeIdOf(value);
  const qualifies = spec.kind === "actor" || spec.kind === "actorType";
  return {
    nation,
    nationLabel: translateMessage(i18n, M.picker.nation),
    nations: [{ key: "", label: translateMessage(i18n, M.picker.anyNation) }, ...catalogNations(i18n)],
    query,
    qualifies,
    rank,
    rankLabel: translateMessage(i18n, M.picker.rank),
    ranks: [{ key: "", label: translateMessage(i18n, M.picker.anyRank) },
      ...SOLDIER_RANKS.map(level => ({ key: String(level), label: String(level + 1) }))],
    searchLabel: translateMessage(i18n, M.picker.search),
    tabs: tabs.map(tab => ({ id: tab.id, label: translateMessage(i18n, M.picker.catalogTab[tab.id as CatalogTabId]),
      options: filterCatalogOptions(tab.options, query).map(option => ({ badge: option.badge, icon: option.icon,
        initial: option.label.charAt(0), key: option.id, label: option.label, selected: option.id === selectedId
      })) })),
    tabsLabel: translateMessage(i18n, M.picker.catalogTabs),
    onNation: setNation,
    onPick: (id: string) => {
      const axes = (getContentEntry(id)?.variants ?? {}) as VariantAxes;
      const withNation = qualifies && nation && axes.nation ? nation : undefined;
      const withRank = qualifies && rank !== "" && axes.rank ? Number(rank) : undefined;
      onChoose(typeValue(spec, { id, nation: withNation, rank: withRank }, filters));
    },
    onQuery: setQuery,
    onRank: setRank
  };
};

/** Family tree tab: every family path with members that fit the slot. */
export const useFamilyPanel = (spec: PickerSpec, value: unknown) => {
  const { i18n } = useLingui();
  const { locale } = i18n;
  const nodes = useMemo(() => familyTree(pickerCatalogFilter(spec), { i18n, locale }), [spec, i18n, locale]);
  const selected = isObject(value) && isObject(value.family) ? String(value.family.id) : "";
  return nodes.map(node => ({ ...node, countText: translateMessage(i18n, M.picker.familyMembers,
    { count: node.count }), selected: node.path === selected }));
};

const literalText = (value: unknown) => {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return isObject(value) && value.k === "lit" ? String(value.value) : "";
};

const questText = (value: unknown): QuestText => (isObject(value) && value.k === "text" && isObject(value.text)
  ? value.text as QuestText : EMPTY_TEXT);

/** Typed inputs: a number, a string, a two-language text, a loop name or a plain number/text field. */
export const useValueInput = (spec: PickerSpec, value: unknown, onChoose: (value: unknown) => void) => {
  const { i18n } = useLingui();
  const [text, setText] = useState(() => literalText(value));
  const [draft, setDraft] = useState(() => questText(value));
  const kind = inputKind(spec);
  const submit = () => {
    if (kind === "text") { onChoose(textValue(draft)); return; }
    if (kind === "number" || kind === "plainNumber") {
      const number = Number(text);
      if (text.trim() === "" && spec.kind === "plainNumber" && spec.nullable) { onChoose(null); return; }
      if (Number.isFinite(number)) onChoose(kind === "number" ? numberValue(number) : number);
      return;
    }
    onChoose(kind === "string" ? stringValue(text) : text);
  };
  return {
    kind, text,
    textRows: textLanguageRows(draft, i18n),
    inputMode: (kind === "string" || kind === "plain" ? "text" : "decimal") as "text" | "decimal",
    label: translateMessage(i18n, kind === "number" || kind === "plainNumber" ? M.picker.number : M.picker.text),
    mathLabel: translateMessage(i18n, M.picker.tabMath),
    onMath: () => onChoose(mathValue(value)), onSubmit: submit,
    onText: setText,
    onTextLanguage: (language: string, entry: string) =>
      setDraft(current => withTextLanguage(current, language, entry))
  };
};

/** Which input a value tab shows. */
export const inputKind = (spec: PickerSpec) => {
  if (spec.kind === "plainNumber") return "plainNumber";
  if (spec.kind === "name" || spec.kind === "plainText") return "plain";
  if (spec.kind === "value" && spec.type === "text") return "text";
  if (spec.kind === "value" && (spec.type === "string")) return "string";
  return "number";
};

const REWARD_TABS: Readonly<Record<"goods" | "rewards" | "soldiers", readonly RewardPickerTab[]>> = {
  goods: ["wares"], rewards: ["wares", "people", "decorations", "misc"], soldiers: ["people"]
};

/** Rewards, goods and soldier lines through the shared RewardPicker (a draft until "Choose"). */
export const useRewardLines = (kind: "goods" | "rewards" | "soldiers", value: unknown,
  onChoose: (value: unknown) => void) => {
  const toEntries = () => {
    if (kind === "goods") return goodsToEntries(value);
    if (kind === "soldiers") return soldiersToEntries(value);
    return Array.isArray(value) ? value as RewardEntry[] : [];
  };
  const [entries, setEntries] = useState<RewardEntry[]>(toEntries);
  return {
    entries,
    tabs: REWARD_TABS[kind],
    onChange: setEntries,
    onSubmit: () => {
      if (kind === "goods") onChoose(entriesToGoods(entries));
      else if (kind === "soldiers") onChoose(entriesToSoldiers(entries));
      else onChoose(entries);
    }
  };
};
