import { useLingui } from "@lingui/react";
import { useState } from "react";

import { translateMessage } from "../../../shared/i18n/translate";
import type { StockGoods } from "../../../shared/trade/stock-move";
import { IconButton } from "../../components/icon-button";
import { WareIcon } from "../../components/ware-icon";
import { formatWholeNumber } from "../helpers";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { clampClaimAmount, getClaimLabel, type MarketWareRow } from "./helpers";

interface MarketWareCellProps {
  claimDisabled?: boolean;
  row: MarketWareRow;
  onClaim?: (goods: StockGoods) => void;
}
const MarketWareCell = ({ claimDisabled, row, onClaim }: MarketWareCellProps) => {
  const { i18n } = useLingui();
  const [amount, setAmount] = useState<number | null>(null);
  const claimed = clampClaimAmount(row.count, amount ?? row.count);
  const update = (value: number) => setAmount(clampClaimAmount(row.count, value));
  return (
    <div aria-label={row.label} className="player-market__ware" data-ware={row.ware}>
      <WareIcon ware={row.ware} />
      <small>{row.name}</small>
      <b>{formatWholeNumber(row.count)}</b>
      <small className="player-market__provenance">
        {row.received > 0 && translateMessage(i18n, M.market.receivedGoods, {
          count: formatWholeNumber(row.received)
        })}
        {row.received > 0 && row.count - row.received > 0 && " · "}
        {row.count - row.received > 0 && translateMessage(i18n, M.market.depositedGoods, {
          count: formatWholeNumber(row.count - row.received)
        })}
      </small>
      {onClaim && (
        <div className="player-market__claim-controls">
          <button
            aria-label={i18n._(M.trade.less)}
            className="player-market__step"
            disabled={claimDisabled || claimed <= 1}
            type="button"
            onClick={() => update(claimed - 1)}
          >
            −
          </button>
          <input
            aria-label={i18n._(M.market.amount)}
            className="player-market__claim-amount"
            disabled={claimDisabled}
            max={row.count}
            min={1}
            step={1}
            type="number"
            value={claimed}
            onChange={event => update(event.target.valueAsNumber)}
          />
          <button
            aria-label={i18n._(M.trade.more)}
            className="player-market__step"
            disabled={claimDisabled || claimed >= row.count}
            type="button"
            onClick={() => update(claimed + 1)}
          >
            +
          </button>
          <button
            aria-label={getClaimLabel(row, i18n, claimed)}
            className="settlement-ui__button player-market__claim"
            disabled={claimDisabled}
            type="button"
            onClick={() => onClaim({ [row.ware]: claimed })}
          >
            {i18n._(M.common.claim)}
          </button>
        </div>
      )}
    </div>
  );
};

interface WarehouseGridProps {
  claimDisabled?: boolean;
  rows: readonly MarketWareRow[];
  onClaim?: (goods: StockGoods) => void;
}
const WarehouseGrid = ({ claimDisabled, rows, onClaim }: WarehouseGridProps) => (
  <div className="player-market__ware-grid">
    {rows.map(row => (
      <MarketWareCell
        claimDisabled={claimDisabled}
        key={row.ware}
        row={row}
        onClaim={onClaim}
      />
    ))}
  </div>
);

interface HomeStorageProps {
  rows: readonly MarketWareRow[];
}
/** The 12 Market wares in the saved home island's completed storages, including empty ones. */
export const HomeStorage = ({ rows }: HomeStorageProps) => {
  const { i18n } = useLingui();
  return (
    <section aria-label={i18n._(M.market.homeStorage)} className="player-market__section">
      <h3>{i18n._(M.market.homeStorage)}</h3>
      <p className="player-market__note">{i18n._(M.market.homeStorageNote)}</p>
      <WarehouseGrid rows={rows} />
    </section>
  );
};

interface MarketWalletProps {
  busy: boolean;
  rows: readonly MarketWareRow[];
  onClaim: (goods: StockGoods) => void;
  onClaimAll: () => void;
}
/** Free wallet goods waiting for an explicit claim; nothing here is pushed into an offline island. */
export const MarketWallet = ({ busy, rows, onClaim, onClaimAll }: MarketWalletProps) => {
  const { i18n } = useLingui();
  return (
    <section aria-label={i18n._(M.market.walletAria)} className="player-market__section">
      <div className="player-market__section-head">
        <h3>{i18n._(M.market.wallet)}</h3>
        <IconButton
          caption={i18n._(M.market.claimAll)}
          disabled={busy || !rows.length}
          icon="apply"
          label={i18n._(M.market.claimAllLabel)}
          onClick={onClaimAll}
        />
      </div>
      <p className="player-market__note">{i18n._(M.market.walletNote)}</p>
      {rows.length > 0 && <WarehouseGrid claimDisabled={busy} rows={rows} onClaim={onClaim} />}
      {rows.length === 0 && <p className="player-market__empty">{i18n._(M.market.walletEmpty)}</p>}
    </section>
  );
};
