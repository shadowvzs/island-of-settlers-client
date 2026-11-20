import type { MessageDescriptor } from "@lingui/core";
import { useLingui } from "@lingui/react";
import { useMemo, useState } from "react";

import { translateMessage } from "../../../shared/i18n/translate";
import { DEFAULT_REWARD_NATION } from "../../settlement-ui/reward-icons/constants";
import type { RewardEntry } from "../../settlement-ui/reward-icons/entries";
import { getRewardIconsView, rewardEntryKey } from "../../settlement-ui/reward-icons/helpers";
import { rewardPickerOptions } from "./catalog";
import { DEFAULT_REWARD_PICKER_TABS, type RewardPickerTab } from "./constants";
import {
  filterRewardOptions, groupedSelectedRewardRows, withRewardAmount, withRewardRemoved, withRewardToggled
} from "./helpers";
import { REWARD_PICKER_MESSAGES as M } from "./messages";
import { searchLocales } from "./search-locales";

/** Headings a caller may word for its own use (e.g. a map's start setup instead of rewards). */
export type RewardPickerCopy = Partial<Record<"empty" | "selected" | "title", MessageDescriptor>>;

/**
 * Narrows the offered options inside the tabs (e.g. wallet-only rewards, cargo soldiers without a rank). Pass a
 * module constant: the option lists are rebuilt when the function changes.
 */
export type RewardPickerFilter = (entry: RewardEntry) => boolean;

export interface RewardPickerOptions {
  copy?: RewardPickerCopy;
  entries: readonly RewardEntry[];
  filter?: RewardPickerFilter;
  nation?: string;
  tabs?: readonly RewardPickerTab[];
  onChange: (entries: RewardEntry[]) => void;
}

/** Each offered tab's options (names, pictures, search text), rebuilt only when the locale or nation changes. */
const useTabOptions = (tabs: readonly RewardPickerTab[], nation: string, filter?: RewardPickerFilter) => {
  const { i18n } = useLingui();
  const catalogKey = [i18n.locale, nation, ...tabs].join("|");
  return useMemo(() => {
    const [, catalogNation = nation, ...catalogTabs] = catalogKey.split("|") as [string, string, ...RewardPickerTab[]];
    const context = { i18n, nation: catalogNation, searchLocales: searchLocales() };
    return catalogTabs.map(tab => {
      const options = rewardPickerOptions(tab, context);
      return { options: filter ? options.filter(option => filter(option.entry)) : options, tab };
    });
  }, [catalogKey, filter, i18n, nation]);
};

/**
 * The reward picker's view model: the search query, one tab per offered kind with its matching options (selected
 * ones pressed), the selected lines (coins, XP and gems on one currency row) and their icon summary. Every change goes out through `onChange`.
 */
export const useRewardPicker = ({
  copy = {}, entries, filter, nation = DEFAULT_REWARD_NATION, onChange, tabs = DEFAULT_REWARD_PICKER_TABS
}: RewardPickerOptions) => {
  const { i18n } = useLingui();
  const [query, setQuery] = useState("");
  const tabOptions = useTabOptions(tabs, nation, filter);
  const selectedKeys = new Set(entries.map(rewardEntryKey));
  const searching = query.trim().length > 0;
  const { currencies, items } = groupedSelectedRewardRows(entries, nation, i18n);
  return {
    currencyRows: currencies,
    emptyNote: translateMessage(i18n, copy.empty ?? M.empty),
    hasSelection: entries.length > 0,
    query,
    rows: items,
    searchLabel: translateMessage(i18n, M.search),
    searchPlaceholder: translateMessage(i18n, M.searchPlaceholder),
    selectedTitle: translateMessage(i18n, copy.selected ?? M.selected),
    summary: getRewardIconsView(entries, { i18n, nation }),
    tabs: tabOptions.map(({ options, tab }) => {
      const matches = filterRewardOptions(options, query);
      const label = translateMessage(i18n, M.tabs[tab]);
      return {
        id: tab,
        label: searching ? translateMessage(i18n, M.tabCount, { count: matches.length, label }) : label,
        noMatches: matches.length ? "" : translateMessage(i18n, M.noMatches, { query: query.trim() }),
        options: matches.map(option => ({
          icon: option.icon, initial: option.label.charAt(0), key: option.key, label: option.label,
          selected: selectedKeys.has(option.key)
        }))
      };
    }),
    tabsLabel: translateMessage(i18n, M.tabsLabel),
    title: translateMessage(i18n, copy.title ?? M.title),
    onAmountChange: (key: string, value: number) => onChange(withRewardAmount(entries, key, value)),
    onQueryChange: setQuery,
    onRemove: (key: string) => onChange(withRewardRemoved(entries, key)),
    onPick: (key: string) => {
      const option = tabOptions.flatMap(tab => tab.options).find(item => item.key === key);
      if (option) onChange(withRewardToggled(entries, option.entry));
    }
  };
};

export type RewardPickerView = ReturnType<typeof useRewardPicker>;
