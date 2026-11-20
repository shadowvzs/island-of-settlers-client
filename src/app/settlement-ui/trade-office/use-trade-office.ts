import { useLingui } from "@lingui/react";
import { type KeyboardEvent, useMemo, useRef, useState } from "react";

import { translateMessage } from "../../../shared/i18n/translate";
import { useExternalStore } from "../../components/external-store";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiStore } from "../ui-store";
import { getFooterButtons, getShownPanel, getTradeError, type TradeError, type TradeOfficePanel } from "./helpers";
import { filterMarketRows, getMarketEmptyText, type MarketRow, type TradeCategory } from "./market-helpers";
import {
  getEmptyText, getHistoryEmptyText, getNpcTradersOffText, getOfferCountText, getOffersEmptyText, type OwnOfferRow
} from "./offers-helpers";
import type { SettlementTradeOffice } from "./types";
import { usePlaceOffer } from "./use-place-offer";
import { useTradeOfficeData } from "./use-trade-office-data";

interface WindowMessages {
  cancel: OwnOfferRow | null;
  error: TradeError | null;
  opened: number;
  status: string;
}

/** Refocuses the element that opened a dialog, else the window content (the dialog's button is gone). */
const restoreFocus = (opener: HTMLElement | null, root: HTMLElement | null) => {
  if (opener?.isConnected && !opener.matches(":disabled")) opener.focus();
  else root?.focus();
};

/**
 * Trade office state: shown panel, filters, the place-offer draft, the status line and the two dialogs
 * (error, cancel confirmation). Commands run synchronously; a refusal opens the error dialog with its reason.
 * Each open clears the status and dialogs; panel, filters and the draft are kept.
 */
export const useTradeOffice = (
  store: SettlementUiStore, visibility: SettlementWindowVisibilityStore, trade: SettlementTradeOffice
) => {
  const { i18n } = useLingui();
  const { opened, visible } = useExternalStore(visibility);
  const [panel, setPanel] = useState<TradeOfficePanel>("market");
  const [category, setCategory] = useState<TradeCategory>("all");
  const [search, setSearch] = useState("");
  const [revision, setRevision] = useState(0);
  const [messages, setMessages] = useState<WindowMessages>({ cancel: null, error: null, opened, status: "" });
  if (messages.opened !== opened) setMessages({ cancel: null, error: null, opened, status: "" });
  const data = useTradeOfficeData(store, trade, panel, revision, visible);
  const place = usePlaceOffer(trade, data.giveChoices, data.wantChoices);
  const rootRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const market = useMemo(() => filterMarketRows(data.market, category, search), [category, data.market, search]);
  const show = (next: Partial<WindowMessages>) => {
    if (next.cancel || next.error) openerRef.current = document.activeElement as HTMLElement | null;
    setMessages(current => ({ ...current, ...next }));
  };
  const finish = (result: true | string, title: string, success: string) => {
    setRevision(current => current + 1);
    const error = getTradeError(result, title);
    show(error ? { error, status: "" } : { status: success });
    return result === true;
  };
  const closeDialog = () => {
    setMessages(current => ({ ...current, cancel: null, error: null }));
    restoreFocus(openerRef.current, rootRef.current);
  };
  return {
    cancelRequest: messages.cancel,
    category,
    countText: getOfferCountText(data.activeOffers, data.offerLimit, i18n),
    data,
    error: messages.error,
    footer: getFooterButtons(panel, i18n),
    historyEmptyText: getEmptyText(data.history.length, getHistoryEmptyText(i18n)),
    market,
    marketEmptyText: market.length ? "" : getMarketEmptyText(data.market.length, i18n),
    npcNote: data.npcTradersOff ? getNpcTradersOffText(i18n) : "",
    offersEmptyText: getEmptyText(data.offers.length, getOffersEmptyText(i18n)),
    place,
    rootRef,
    search,
    shown: getShownPanel(panel),
    status: messages.status,
    onBuy: (row: MarketRow) => {
      // A bought offer is taken: its Buy button turns disabled, so focus stays in the window.
      if (finish(trade.buy(row.id), i18n._(M.trade.purchaseFailed),
        translateMessage(i18n, M.trade.boughtSuccess, { wares: row.give.text })))
        rootRef.current?.focus();
    },
    onCategory: setCategory,
    onCloseDialog: closeDialog,
    onConfirmCancel: () => {
      const row = messages.cancel;
      if (!row) return;
      setMessages(current => ({ ...current, cancel: null }));
      if (finish(trade.cancelOffer(row.id), i18n._(M.trade.offerNotCancelled),
        translateMessage(i18n, M.trade.cancelledSuccess, { returnText: row.returnText })))
        rootRef.current?.focus();
    },
    onDiscardPlace: () => {
      place.reset();
      setPanel("market");
    },
    onConfirmPlace: () => {
      if (!place.give || !place.want) return;
      if (!finish(trade.placeOffer(place.give, place.want), i18n._(M.trade.offerNotPlaced),
        i18n._(M.trade.placedSuccess))) return;
      place.reset();
      setPanel("offers");
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "Escape") return;
      // Dialogs, then the open picker take Escape; otherwise the settlement UI closes the window.
      if (messages.cancel || messages.error) closeDialog();
      else if (place.pickerSide) place.closePicker(true);
      else return;
      event.preventDefault();
      event.stopPropagation();
    },
    onPanel: setPanel,
    onRequestCancel: (row: OwnOfferRow) => show({ cancel: row }),
    onSearch: setSearch
  };
};
export type TradeOfficeState = ReturnType<typeof useTradeOffice>;
