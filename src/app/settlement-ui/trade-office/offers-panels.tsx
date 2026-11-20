import { useLingui } from "@lingui/react";

import { IconButton } from "../../components/icon-button";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { OwnOfferRow, TradeHistoryRow } from "./offers-helpers";
import { TradeLotBadge, TradePair } from "./trade-lot";

interface OwnOfferItemProps {
  row: OwnOfferRow;
  onCancel: (row: OwnOfferRow) => void;
}
const OwnOfferItem = ({ row, onCancel }: OwnOfferItemProps) => {
  const { i18n } = useLingui();
  return (
  <li className="trade-office__row trade-office__own" data-own-offer={row.id}>
    {row.pair && <TradePair give={row.pair.give} want={row.pair.want} />}
    {row.goodsText && <span className="trade-office__goods">{row.goodsText}</span>}
    <span className="trade-office__merchant trade-office__status">{row.status}</span>
    {row.canCancel && (
      <IconButton
        caption={i18n._(M.common.cancel)}
        className="trade-office__cancel"
        icon="cancel"
        label={row.cancelLabel}
        title={i18n._(M.trade.cancelTitle)}
        onClick={() => onCancel(row)}
      />
    )}
  </li>
  );
};

interface MyOffersPanelProps {
  countText: string;
  emptyText: string;
  npcNote: string;
  rows: readonly OwnOfferRow[];
  onCancel: (row: OwnOfferRow) => void;
}
/** Active own offers (with status) and the trade-ship deliveries on their way. */
export const MyOffersPanel = ({ countText, emptyText, npcNote, rows, onCancel }: MyOffersPanelProps) => {
  const { i18n } = useLingui();
  return (
  <section aria-label={i18n._(M.trade.myOffers)} className="trade-office__offers">
    <p className="trade-office__count">{countText}</p>
    {npcNote && <p className="trade-office__note" data-npc-traders="off">{npcNote}</p>}
    <ul className="trade-office__list">
      {rows.map(row => <OwnOfferItem key={row.id} row={row} onCancel={onCancel} />)}
    </ul>
    {emptyText && <p className="trade-office__empty">{emptyText}</p>}
  </section>
  );
};

interface HistoryItemProps {
  row: TradeHistoryRow;
}
const HistoryItem = ({ row }: HistoryItemProps) => (
  <li className="trade-office__row trade-office__history-row" data-history-kind={row.kind}>
    <span className="trade-office__pair">
      {row.gave && <TradeLotBadge lot={row.gave} />}
      {row.received && <span aria-hidden="true" className="trade-office__arrow">→</span>}
      {row.received && <TradeLotBadge lot={row.received} />}
    </span>
    <span className="trade-office__merchant">
      {row.title}
      <time className="trade-office__status">{row.time}</time>
    </span>
  </li>
);

interface HistoryPanelProps {
  emptyText: string;
  rows: readonly TradeHistoryRow[];
}
/** Bought / sold / cancelled trades, newest first, with the real date and time. */
export const HistoryPanel = ({ emptyText, rows }: HistoryPanelProps) => {
  const { i18n } = useLingui();
  return (
  <section aria-label={i18n._(M.trade.tradeHistory)} className="trade-office__history">
    <ul className="trade-office__list">
      {rows.map(row => <HistoryItem key={row.id} row={row} />)}
    </ul>
    {emptyText && <p className="trade-office__empty">{emptyText}</p>}
  </section>
  );
};
