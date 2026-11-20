import { useLingui } from "@lingui/react";

import { IconButton } from "../../components/icon-button";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiStore } from "../ui-store";
import { MarketPanel } from "./market-panel";
import { HistoryPanel, MyOffersPanel } from "./offers-panels";
import { PlaceOfferPanel } from "./place-offer-panel";
import { CancelOfferDialog, TradeErrorDialog } from "./trade-dialogs";
import type { SettlementTradeOffice } from "./types";
import { type TradeOfficeState, useTradeOffice } from "./use-trade-office";

interface FooterProps {
  buttons: TradeOfficeState["footer"];
  onPanel: TradeOfficeState["onPanel"];
}
const Footer = ({ buttons, onPanel }: FooterProps) => {
  const { i18n } = useLingui();
  return (
  <nav aria-label={i18n._(M.trade.sections)} className="trade-office__footer">
    {buttons.map(button => (
      <IconButton
        caption={button.label}
        icon={button.icon}
        key={button.id}
        label={button.label}
        pressed={button.pressed}
        onClick={() => onPanel(button.id)}
      />
    ))}
  </nav>
  );
};

interface TradeOfficeViewProps {
  rootRef: TradeOfficeState["rootRef"];
  state: TradeOfficeState;
}
/** The shown panel, the status line, the footer and the open dialog. */
const TradeOfficeView = ({ rootRef, state }: TradeOfficeViewProps) => (
  // Delegated Escape/keyboard handling belongs to this window root; child controls remain interactive.
  // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
  <div className="trade-office" ref={rootRef} tabIndex={-1} onKeyDown={state.onKeyDown}>
    {state.shown.market && (
      <MarketPanel
        category={state.category}
        emptyText={state.marketEmptyText}
        rows={state.market}
        search={state.search}
        onBuy={state.onBuy}
        onCategory={state.onCategory}
        onSearch={state.onSearch}
      />
    )}
    {state.shown.place && (
      <PlaceOfferPanel
        countText={state.countText}
        place={state.place}
        onCancel={state.onDiscardPlace}
        onConfirm={state.onConfirmPlace}
      />
    )}
    {state.shown.offers && (
      <MyOffersPanel
        countText={state.countText}
        emptyText={state.offersEmptyText}
        npcNote={state.npcNote}
        rows={state.data.offers}
        onCancel={state.onRequestCancel}
      />
    )}
    {state.shown.history && (
      <HistoryPanel emptyText={state.historyEmptyText} rows={state.data.history} />
    )}
    <small className="trade-office__status-line" role="status">{state.status}</small>
    <Footer buttons={state.footer} onPanel={state.onPanel} />
    {state.error && <TradeErrorDialog error={state.error} onClose={state.onCloseDialog} />}
    {state.cancelRequest && (
      <CancelOfferDialog row={state.cancelRequest} onClose={state.onCloseDialog} onConfirm={state.onConfirmCancel} />
    )}
  </div>
);

interface TradeOfficeProps {
  store: SettlementUiStore;
  trade: SettlementTradeOffice;
  visibility: SettlementWindowVisibilityStore;
}
/** Harbour trade office: merchant market, place offer, my offers and history of the island on screen. */
export const TradeOffice = ({ store, trade, visibility }: TradeOfficeProps) => {
  const state = useTradeOffice(store, visibility, trade);
  return <TradeOfficeView rootRef={state.rootRef} state={state} />;
};
