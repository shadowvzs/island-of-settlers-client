import { useLingui } from "@lingui/react";
import { useState } from "react";

import type { TradeLot } from "../../../shared/trade/trade-types";
import {
  clampLot, EMPTY_PLACE_DRAFT, getEstimate, getPickerView, getSideButtonId, getSideChoices, getSideView,
  pickDraftWare, type PlaceOfferDraft, type PlaceSide, type WareChoice
} from "./place-offer-helpers";
import type { SettlementTradeOffice } from "./types";

/**
 * Place-offer draft: both sides (ware + amount, clamped to the current stock / room) and the open picker.
 * The draft survives panel changes and closing the window; a placed offer starts a new one.
 */
export const usePlaceOffer = (
  trade: SettlementTradeOffice, giveChoices: readonly WareChoice[], wantChoices: readonly WareChoice[]
) => {
  const { i18n } = useLingui();
  const [draft, setDraft] = useState<PlaceOfferDraft>(EMPTY_PLACE_DRAFT);
  const give = clampLot(draft.give, giveChoices), want = clampLot(draft.want, wantChoices);
  const choicesOf = (side: PlaceSide) =>
    getSideChoices(draft, side, side === "give" ? giveChoices : wantChoices);
  const setLot = (side: PlaceSide, lot: TradeLot) => setDraft(current => ({ ...current, [side]: lot }));
  const picker = draft.picker
    && getPickerView(draft.picker, choicesOf(draft.picker), draft[draft.picker], i18n);
  return {
    confirmDisabled: !give || !want,
    estimate: getEstimate(trade, give, want, i18n),
    give,
    picker,
    pickerSide: draft.picker,
    sides: [getSideView("give", give, draft.picker === "give", i18n),
      getSideView("want", want, draft.picker === "want", i18n)],
    want,
    /** Closes the picker; `refocus` moves focus back to its side button (Escape, Done). */
    closePicker: (refocus = false) => {
      if (refocus && draft.picker) document.getElementById(getSideButtonId(draft.picker))?.focus();
      setDraft(current => ({ ...current, picker: null }));
    },
    reset: () => setDraft(EMPTY_PLACE_DRAFT),
    onAmount: (amount: number) => {
      const side = draft.picker, lot = side && draft[side];
      if (side && lot) setLot(side, { amount, ware: lot.ware });
    },
    onPickWare: (ware: string) => {
      const side = draft.picker;
      if (!side) return;
      const max = choicesOf(side).find(choice => choice.ware === ware)?.max ?? 1;
      setDraft(current => pickDraftWare(current, side, ware, max));
    },
    onToggleSide: (side: PlaceSide) =>
      setDraft(current => ({ ...current, picker: current.picker === side ? null : side }))
  };
};
export type PlaceOfferState = ReturnType<typeof usePlaceOffer>;
