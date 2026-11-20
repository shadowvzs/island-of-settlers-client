import type { I18n } from "@lingui/core";

import { CAMPAIGN_SOLDIER_TYPES } from "../../../../../island-of-settlers-shared/src/campaign/campaign-constants";
import { WARE_IDS } from "../../../render-common/wares/ware-catalog";
import { listDecorationEntries } from "../../../shared/world/editing/decoration-registry";
import type { RewardEntry } from "../../settlement-ui/reward-icons/entries";
import { describeRewardEntry, rewardEntryKey,type RewardIconArt } from "../../settlement-ui/reward-icons/helpers";
import { COIN_WARE_ID, REWARD_SOLDIER_RANKS, type RewardPickerTab } from "./constants";

/** One choosable reward: its entry (amount 1), picture, name and folded search text. */
export interface RewardPickerOption {
  entry: RewardEntry;
  icon: RewardIconArt;
  key: string;
  label: string;
  searchText: string;
}

/**
 * What option names and pictures depend on: the active locale, the nation (portraits, troop names) and the extra
 * locales whose names the search also matches.
 */
export interface RewardCatalogContext {
  i18n?: I18n;
  nation: string;
  searchLocales: readonly I18n[];
}

/** Lower case without diacritics: "Kőfaragó" and "kofarago" match. */
export const foldSearchText = (text: string) =>
  text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

let decorationIds: readonly string[] | undefined;

/** Decoration items of the editor palette (the decoration registry), each finish/variant once. */
export const rewardDecorationIds = (): readonly string[] => {
  decorationIds ??= Object.freeze(listDecorationEntries()
    .flatMap(entry => (entry.source === "placed" ? entry.items : [])));
  return decorationIds;
};

/** Only catalogued decorations can be picked; older free-text ids are read but flagged. */
export const isRewardDecorationId = (id: string) => rewardDecorationIds().includes(id);

const wareEntries = (): RewardEntry[] => WARE_IDS
  .filter(ware => ware !== COIN_WARE_ID)
  .map(ware => ({ amount: 1, kind: "ware", ware }));

const peopleEntries = (): RewardEntry[] => [
  { amount: 1, kind: "settlers" },
  ...CAMPAIGN_SOLDIER_TYPES.flatMap(soldierType => REWARD_SOLDIER_RANKS
    .map((rank): RewardEntry => ({ amount: 1, kind: "soldier", rank, soldierType })))
];

const decorationEntries = (): RewardEntry[] => rewardDecorationIds()
  .map(item => ({ amount: 1, item, kind: "decoration" }));

const miscEntries = (): RewardEntry[] => [
  { amount: 1, kind: "coins" }, { amount: 1, kind: "gems" }, { amount: 1, kind: "xp" }
];

/** The rewards a tab offers (new tabs such as buildings or ships add a case). */
const tabEntries = (tab: RewardPickerTab): RewardEntry[] => {
  switch (tab) {
  case "wares": return wareEntries();
  case "people": return peopleEntries();
  case "decorations": return decorationEntries();
  case "misc": return miscEntries();
  default: return [];
  }
};

/** The option of one entry; its search text joins its names in the active and the search locales. */
export const toRewardPickerOption = (entry: RewardEntry, context: RewardCatalogContext): RewardPickerOption => {
  const { icon, label } = describeRewardEntry(entry, context.nation, context.i18n);
  const names = context.searchLocales.map(i18n => describeRewardEntry(entry, context.nation, i18n).label);
  return { entry, icon, key: rewardEntryKey(entry), label, searchText: foldSearchText([label, ...names].join(" ")) };
};

/** The options of a tab, in catalog order. */
export const rewardPickerOptions = (tab: RewardPickerTab, context: RewardCatalogContext) =>
  tabEntries(tab).map(entry => toRewardPickerOption(entry, context));
