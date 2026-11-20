import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import type { RewardEntry } from "../../settlement-ui/reward-icons/entries";
import { describeRewardEntry, rewardEntryKey } from "../../settlement-ui/reward-icons/helpers";
import { foldSearchText, isRewardDecorationId, type RewardPickerOption } from "./catalog";
import {
  CURRENCY_REWARD_KINDS, MAX_REWARD_AMOUNT, MAX_SETTLER_REWARD, MIN_REWARD_AMOUNT
} from "./constants";
import { REWARD_PICKER_MESSAGES as M } from "./messages";

/** Options whose names contain every word of the query (case and diacritics ignored); a blank query keeps all. */
export const filterRewardOptions = (options: readonly RewardPickerOption[], query: string) => {
  const words = foldSearchText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return options;
  return options.filter(option => words.every(word => option.searchText.includes(word)));
};

/** The largest amount of a reward line (settlers use the count limit). */
export const maxRewardAmount = (entry: RewardEntry) =>
  (entry.kind === "settlers" ? MAX_SETTLER_REWARD : MAX_REWARD_AMOUNT);

/** A whole amount within 1..max from an input value; blank or invalid input gives the minimum. */
export const clampRewardAmount = (entry: RewardEntry, value: number | string) => {
  const amount = Math.floor(Number(value));
  if (!Number.isFinite(amount) || amount < MIN_REWARD_AMOUNT) return MIN_REWARD_AMOUNT;
  return Math.min(amount, maxRewardAmount(entry));
};

const hasReward = (entries: readonly RewardEntry[], key: string) =>
  entries.some(entry => rewardEntryKey(entry) === key);

/** Appends the reward (amount 1); a reward already in the list stays as it is. */
export const withRewardAdded = (entries: readonly RewardEntry[], entry: RewardEntry): RewardEntry[] =>
  (hasReward(entries, rewardEntryKey(entry)) ? [...entries] : [...entries, entry]);

export const withRewardRemoved = (entries: readonly RewardEntry[], key: string) =>
  entries.filter(entry => rewardEntryKey(entry) !== key);

/** An option click: adds the reward, or removes it when it is already selected. */
export const withRewardToggled = (entries: readonly RewardEntry[], entry: RewardEntry) => {
  const key = rewardEntryKey(entry);
  return hasReward(entries, key) ? withRewardRemoved(entries, key) : withRewardAdded(entries, entry);
};

/** The amount of one line, clamped; rewards without an amount (unlocks) are unchanged. */
export const withRewardAmount = (entries: readonly RewardEntry[], key: string, value: number | string) =>
  entries.map(entry => (rewardEntryKey(entry) !== key || !("amount" in entry)
    ? entry : { ...entry, amount: clampRewardAmount(entry, value) }));

/** A decoration id outside the catalog (older free-text rewards): kept and shown, with a warning. */
export const unknownDecorationId = (entry: RewardEntry) =>
  (entry.kind === "decoration" && !isRewardDecorationId(entry.item) ? entry.item : null);

const rowWarning = (entry: RewardEntry, i18n?: I18n) => {
  const id = unknownDecorationId(entry);
  return id === null ? "" : translateMessage(i18n, M.unknownDecoration, { id });
};

const selectedRewardRow = (entry: RewardEntry, nation: string, i18n?: I18n) => {
  const { icon, label } = describeRewardEntry(entry, nation, i18n);
  const amount = "amount" in entry ? entry.amount : null;
  return {
    amount,
    amountLabel: translateMessage(i18n, M.amountOf, { name: label }),
    icon,
    key: rewardEntryKey(entry),
    label,
    max: maxRewardAmount(entry),
    removeLabel: translateMessage(i18n, M.removeName, { name: label }),
    warning: rowWarning(entry, i18n)
  };
};

/** One selected line: picture, name, amount field (absent for unlocks), its limit and a warning for bad ids. */
export const selectedRewardRows = (entries: readonly RewardEntry[], nation: string, i18n?: I18n) =>
  entries.map(entry => selectedRewardRow(entry, nation, i18n));

export type SelectedRewardRow = ReturnType<typeof selectedRewardRows>[number];

const currencyRank = (entry: RewardEntry) => (CURRENCY_REWARD_KINDS as readonly string[]).indexOf(entry.kind);

/**
 * The selected lines grouped for display: coins, XP and gems as one compact currency row (fixed order), every
 * other reward as its own line in list order.
 */
export const groupedSelectedRewardRows = (entries: readonly RewardEntry[], nation: string, i18n?: I18n) => {
  const currencies = entries.filter(entry => currencyRank(entry) >= 0)
    .sort((left, right) => currencyRank(left) - currencyRank(right));
  return {
    currencies: selectedRewardRows(currencies, nation, i18n),
    items: selectedRewardRows(entries.filter(entry => currencyRank(entry) < 0), nation, i18n)
  };
};
