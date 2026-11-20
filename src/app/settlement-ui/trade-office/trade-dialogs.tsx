import { useLingui } from "@lingui/react";

import { IconButton } from "../../components/icon-button";
import { Popup } from "../../components/popup";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { TradeError } from "./helpers";
import type { OwnOfferRow } from "./offers-helpers";

const TRADE_ERROR_TITLE_ID = "trade-office-error-title";
const TRADE_CANCEL_TITLE_ID = "trade-office-cancel-title";

interface TradeErrorDialogProps {
  error: TradeError;
  onClose: () => void;
}
/** A refused command: the simulation's reason, OK closes (Escape too). */
export const TradeErrorDialog = ({ error, onClose }: TradeErrorDialogProps) => {
  const { i18n } = useLingui();
  return (
  <div className="trade-office__dialog-layer">
    <Popup
      actions={<IconButton caption={i18n._(M.common.ok)} icon="apply" label={i18n._(M.common.ok)}
        onClick={onClose} />}
      className="trade-office__dialog"
      focusKey={error}
      labelledBy={TRADE_ERROR_TITLE_ID}
      tone="defeat"
    >
      <h2 id={TRADE_ERROR_TITLE_ID}>{error.title}</h2>
      <p>{error.message}</p>
    </Popup>
  </div>
  );
};

interface CancelOfferDialogProps {
  row: OwnOfferRow;
  onClose: () => void;
  onConfirm: () => void;
}
/** Cancel confirmation listing what returns physically; Keep is focused first. */
export const CancelOfferDialog = ({ row, onClose, onConfirm }: CancelOfferDialogProps) => {
  const { i18n } = useLingui();
  return (
  <div className="trade-office__dialog-layer">
    <Popup
      actions={(
        <>
          <IconButton caption={i18n._(M.common.keep)} icon="apply" label={i18n._(M.trade.keepOffer)}
            onClick={onClose} />
          <IconButton caption={i18n._(M.trade.cancelOfferAction)} icon="cancel"
            label={i18n._(M.trade.cancelOfferAction)} onClick={onConfirm} />
        </>
      )}
      className="trade-office__dialog"
      focusKey={row}
      labelledBy={TRADE_CANCEL_TITLE_ID}
      tone="info"
    >
      <h2 id={TRADE_CANCEL_TITLE_ID}>{i18n._(M.trade.cancelQuestion)}</h2>
      <p>{row.returnText}</p>
    </Popup>
  </div>
  );
};
