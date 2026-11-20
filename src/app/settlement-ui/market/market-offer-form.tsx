import { useLingui } from "@lingui/react";

import { translateMessage } from "../../../shared/i18n/translate";
import { IconButton } from "../../components/icon-button";
import { Select } from "../../components/select";
import { formatWareCount } from "../helpers";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { OfferFormView } from "./helpers";

const toAmount = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
};

interface MarketOfferFormProps {
  busy: boolean;
  form: OfferFormView;
  onAmount: (side: "offered" | "requested", amount: number) => void;
  onOffer: () => void;
  onTtl: (seconds: number) => void;
  onWare: (side: "offered" | "requested", ware: string) => void;
}
/**
 * The combined offer form: choose both sides once. On Offer the home goods move to the Market wallet and the
 * offer escrows them in two server steps; a failure after the first step is reported by the pending card.
 */
export const MarketOfferForm = ({ busy, form, onAmount, onOffer, onTtl, onWare }: MarketOfferFormProps) => {
  const { i18n } = useLingui();
  return (
  <section aria-label={i18n._(M.market.offerAria)} className="player-market__section player-market__offer-form">
    <h3>{i18n._(M.market.offerGoods)}</h3>
    <p className="player-market__note">{i18n._(M.market.offerNote)}</p>
    <div className="player-market__form-row">
      <Select
        choices={form.choices}
        label={i18n._(M.market.youOffer)}
        selected={form.offeredWare}
        onChange={ware => onWare("offered", ware)}
      />
      <label className="player-market__field player-market__amount">
        {i18n._(M.market.amount)}
        <input
          aria-label={translateMessage(i18n, M.market.amountOffer, { ware: form.offeredName })}
          max={Math.max(1, form.amountLimit)}
          min={1}
          step={1}
          type="number"
          value={form.offeredAmount}
          onChange={event => onAmount("offered", toAmount(event.target.valueAsNumber))}
        />
        <small>{translateMessage(i18n, M.market.freeAtHome, { wares: formatWareCount(form.amountLimit, form.offeredWare) })}</small>
      </label>
    </div>
    <div className="player-market__form-row">
      <Select
        choices={form.choices}
        label={i18n._(M.market.youRequest)}
        selected={form.requestedWare}
        onChange={ware => onWare("requested", ware)}
      />
      <label className="player-market__field player-market__amount">
        {i18n._(M.market.amount)}
        <input
          aria-label={translateMessage(i18n, M.market.amountRequest, { ware: form.requestedName })}
          max={form.requestedLimit}
          min={1}
          step={1}
          type="number"
          value={form.requestedAmount}
          onChange={event => onAmount("requested", toAmount(event.target.valueAsNumber))}
        />
      </label>
    </div>
    <Select
      choices={form.ttlChoices}
      label={i18n._(M.market.offerLifetime)}
      selected={form.ttlSeconds}
      onChange={onTtl}
    />
    {form.problem && <p className="player-market__form-problem" role="alert">{form.problem}</p>}
    <div className="player-market__offer-submit">
      <IconButton
        caption={i18n._(M.market.offer)}
        disabled={busy || Boolean(form.problem)}
        icon="market"
        label={i18n._(M.market.offerLabel)}
        onClick={onOffer}
      />
    </div>
  </section>
  );
};
