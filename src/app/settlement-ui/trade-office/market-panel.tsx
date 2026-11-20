import { useLingui } from "@lingui/react";

import { IconButton } from "../../components/icon-button";
import { Select } from "../../components/select";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { getTradeCategoryChoices, type MarketRow, type TradeCategory } from "./market-helpers";
import { TradePair } from "./trade-lot";

interface MarketRowItemProps {
  row: MarketRow;
  onBuy: (row: MarketRow) => void;
}
const MarketRowItem = ({ row, onBuy }: MarketRowItemProps) => {
  const { i18n } = useLingui();
  return (
  <li className="trade-office__row" data-offer-id={row.id} data-taken={row.taken}>
    <TradePair give={row.give} want={row.want} />
    <span className="trade-office__merchant">{row.merchant}</span>
    <span className="trade-office__buy-slot" title={row.buyTitle}>
      <IconButton
        caption={i18n._(M.trade.buyAction)}
        className="trade-office__buy"
        disabled={row.buyDisabled}
        icon="apply"
        label={row.buyLabel}
        title={row.buyTitle}
        onClick={() => onBuy(row)}
      />
    </span>
    {row.reason && <small className="trade-office__reason">{row.reason}</small>}
  </li>
  );
};

interface MarketPanelProps {
  category: TradeCategory;
  emptyText: string;
  rows: readonly MarketRow[];
  search: string;
  onBuy: (row: MarketRow) => void;
  onCategory: (category: TradeCategory) => void;
  onSearch: (search: string) => void;
}
/** Category + search filters and the merchant offers in their quoted, stable order. */
export const MarketPanel = ({ category, emptyText, rows, search, onBuy, onCategory, onSearch }: MarketPanelProps) => {
  const { i18n } = useLingui();
  return (
  <section aria-label={i18n._(M.trade.offers)} className="trade-office__market">
    <div className="trade-office__filters">
      <Select choices={getTradeCategoryChoices(i18n)} label={i18n._(M.trade.category)} selected={category}
        onChange={onCategory} />
      <label className="trade-office__search">
        {i18n._(M.trade.search)}
        <input
          aria-label={i18n._(M.trade.searchWares)}
          placeholder={i18n._(M.trade.wareName)}
          type="search"
          value={search}
          onChange={event => onSearch(event.target.value)}
        />
      </label>
    </div>
    <ul className="trade-office__list">
      {rows.map(row => <MarketRowItem key={row.id} row={row} onBuy={onBuy} />)}
    </ul>
    {emptyText && <p className="trade-office__empty">{emptyText}</p>}
  </section>
  );
};
