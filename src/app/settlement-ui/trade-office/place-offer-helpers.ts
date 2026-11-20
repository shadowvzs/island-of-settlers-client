import type { I18n } from "@lingui/core";
import { isMaterialAvailable, TRADE_MAX_LOT_AMOUNT } from "@shared/catalog/balance";

import { translateMessage } from "../../../shared/i18n/translate";
import { wareDisplayName } from "../../../shared/settlement/ware-names";
import type { TradeLot } from "../../../shared/trade/trade-types";
import { isNationTradable, TRADABLE_WARES, type TradeEstimate } from "../../../shared/trade/trade-values";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementUiSnapshot } from "../types";
import { getLotView } from "./helpers";
import { isStorageFull } from "./market-helpers";
import type { SettlementTradeOffice } from "./types";

export type PlaceSide = "give" | "want";

/** The place-offer draft: both sides and which picker is open. */
export interface PlaceOfferDraft {
  give: TradeLot | null;
  picker: PlaceSide | null;
  want: TradeLot | null;
}
export const EMPTY_PLACE_DRAFT: PlaceOfferDraft = { give: null, picker: null, want: null };

/** One pickable ware: its free stock (give) or free room (want) and the largest amount allowed. */
export interface WareChoice {
  available: number;
  label: string;
  max: number;
  name: string;
  ware: string;
}

/** Wares this island may trade: its own nation's drinks, unlocked at the player's level. */
export const getIslandTradeWares = ({ player, playerNation }: SettlementUiSnapshot) =>
  TRADABLE_WARES.filter(ware => isNationTradable(ware, playerNation ?? "roman") &&
    isMaterialAvailable(ware, player?.level ?? 1));

const toChoice = (ware: string, available: number, caption: string, i18n?: I18n): WareChoice => ({
  available,
  label: translateMessage(i18n, caption === "free" ? M.trade.freeStock : M.trade.freeRoom, {
    available, name: wareDisplayName(ware)
  }),
  max: Math.min(available, TRADE_MAX_LOT_AMOUNT),
  name: wareDisplayName(ware),
  ware
});

/** "I give": wares with free stock (stored − reserved, summed over the island's storages); none at 0. */
export const getGiveChoices = (
  trade: Pick<SettlementTradeOffice, "freeStock">, wares: readonly string[], i18n?: I18n
) => wares.map(ware => toChoice(ware, Math.floor(trade.freeStock(ware)), "free", i18n))
    .filter(choice => choice.available > 0);

/** "I want": wares with free storage room; wares whose storage is full are not offered. */
export const getWantChoices = (
  trade: Pick<SettlementTradeOffice, "freeCapacity" | "storageFull">, wares: readonly string[], i18n?: I18n
) => wares.filter(ware => !isStorageFull(trade, ware))
  .map(ware => toChoice(ware, Math.floor(trade.freeCapacity(ware)), "room", i18n))
  .filter(choice => choice.available > 0);

const OTHER_SIDE: Readonly<Record<PlaceSide, PlaceSide>> = { give: "want", want: "give" };

/** A side's picker never offers the ware chosen on the other side (offered and requested wares differ). */
export const getSideChoices = (draft: PlaceOfferDraft, side: PlaceSide, choices: readonly WareChoice[]) => {
  const other = draft[OTHER_SIDE[side]];
  return other ? choices.filter(choice => choice.ware !== other.ware) : choices;
};

/**
 * Picks a ware for a side, keeping its amount within 1..max; the other side is cleared when it holds the same
 * ware (owner rule: the two wares of a trade differ).
 */
export const pickDraftWare = (draft: PlaceOfferDraft, side: PlaceSide, ware: string, max: number) => {
  const amount = Math.max(1, Math.min(draft[side]?.amount ?? 1, max));
  const other = OTHER_SIDE[side];
  const next: PlaceOfferDraft = { ...draft, [side]: { amount, ware } };
  if (draft[other]?.ware === ware) next[other] = null;
  return next;
};

/** The draft amount within 1..max of the chosen ware (stock or room may have changed meanwhile). */
export const clampLot = (lot: TradeLot | null, choices: readonly WareChoice[]): TradeLot | null => {
  if (!lot) return null;
  const choice = choices.find(entry => entry.ware === lot.ware);
  if (!choice) return lot;
  return { amount: Math.max(1, Math.min(lot.amount, choice.max)), ware: lot.ware };
};

const SIDE_TEXT = {
  give: { empty: M.trade.chooseGive, heading: M.trade.give },
  want: { empty: M.trade.chooseWant, heading: M.trade.want }
} as const;

export const getSideButtonId = (side: PlaceSide) => `trade-office-side-${side}`;
const getPickerId = (side: PlaceSide) => `trade-office-picker-${side}`;

/** One side button: the chosen lot or the prompt to choose. */
export const getSideView = (side: PlaceSide, lot: TradeLot | null, open: boolean, i18n?: I18n) => {
  const heading = translateMessage(i18n, SIDE_TEXT[side].heading);
  const empty = translateMessage(i18n, SIDE_TEXT[side].empty);
  return {
  buttonId: getSideButtonId(side),
  empty: lot ? "" : empty,
  heading,
  label: lot ? translateMessage(i18n, M.trade.sideLabel, { heading, lot: getLotView(lot).text }) : empty,
  lot: lot && getLotView(lot),
  open,
  pickerId: getPickerId(side),
  side
  };
};
export type PlaceSideView = ReturnType<typeof getSideView>;

const ESTIMATE_TEXT = {
  likely: M.trade.estimateLikely,
  slowly: M.trade.estimateSlowly,
  unlikely: M.trade.estimateUnlikely
} as const satisfies Readonly<Record<TradeEstimate, unknown>>;

/** Fair-value estimate once both sides are chosen. */
export const getEstimate = (
  trade: Pick<SettlementTradeOffice, "estimate">, give: TradeLot | null, want: TradeLot | null, i18n?: I18n
) => {
  if (!give || !want)
    return { text: translateMessage(i18n, M.trade.estimateChoose), tone: "none" as const };
  const estimate = trade.estimate(give, want);
  return { text: translateMessage(i18n, ESTIMATE_TEXT[estimate]), tone: estimate };
};

const PICKER_TEXT = {
  give: { amount: M.trade.amountToGive, empty: M.trade.noFreeStock, heading: M.trade.chooseGive },
  want: { amount: M.trade.amountWanted, empty: M.trade.storageFullWant, heading: M.trade.chooseWant }
} as const;

/** Picker heading, the ware grid (chosen one pressed) and the chosen ware's amount bounds. */
export const getPickerView = (
  side: PlaceSide, choices: readonly WareChoice[], lot: TradeLot | null, i18n?: I18n
) => {
  const chosen = choices.find(choice => choice.ware === lot?.ware) ?? null;
  return {
    amount: lot?.amount ?? 0,
    amountLabel: translateMessage(i18n, PICKER_TEXT[side].amount),
    choices: choices.map(choice => ({ ...choice, selected: choice.ware === lot?.ware })),
    chosen,
    emptyText: choices.length ? "" : translateMessage(i18n, PICKER_TEXT[side].empty),
    heading: translateMessage(i18n, PICKER_TEXT[side].heading),
    id: getPickerId(side),
    max: chosen?.max ?? 1
  };
};
export type PickerView = ReturnType<typeof getPickerView>;
export type PickerChoice = PickerView["choices"][number];
