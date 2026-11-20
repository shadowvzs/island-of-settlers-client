import { useLingui } from "@lingui/react";

import type { MarketPendingBuy, MarketPendingClaim, MarketPendingOffer } from "../../../shared/trade/market";
import { IconButton } from "../../components/icon-button";
import { WareIcon } from "../../components/ware-icon";
import { formatWholeNumber } from "../helpers";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import {
  getGoodsLots, getPendingBuyText, getPendingBuyTitle, getPendingClaimText, getPendingClaimTitle,
  getPendingOfferText, getPendingOfferTitle, type MarketBuyRow, type MarketLot, type MarketOfferRow
} from "./helpers";

interface GoodsLotsProps {
  lots: readonly MarketLot[];
}
const GoodsLots = ({ lots }: GoodsLotsProps) => {
  const { i18n } = useLingui();
  return (
  <span className="player-market__lots">
    {lots.map(lot => (
      <span aria-label={lot.text} className="player-market__lot" key={lot.ware} role="img">
        <b>{formatWholeNumber(lot.amount)}</b>
        <WareIcon ware={lot.ware} />
      </span>
    ))}
    {lots.length === 0 && <small>{i18n._(M.market.noWares)}</small>}
  </span>
  );
};

interface PendingOfferCardProps {
  busy: boolean;
  pending: MarketPendingOffer;
  onDiscard: () => void;
  onRetry: () => void;
}
/** A combined offer whose deposit or escrow step is not confirmed; retry keeps the same server keys. */
export const PendingOfferCard = ({ busy, pending, onDiscard, onRetry }: PendingOfferCardProps) => {
  const { i18n } = useLingui();
  return (
  <section aria-label={i18n._(M.market.unfinishedOffer)} className="player-market__pending">
    <h3>{getPendingOfferTitle(pending, i18n)}</h3>
    <p>{getPendingOfferText(pending, i18n)}</p>
    <p className="player-market__pending-goods">
      <small>{i18n._(M.market.youOffer)}</small><GoodsLots lots={getGoodsLots(pending.offered)} />
      <small>{i18n._(M.market.youRequest)}</small><GoodsLots lots={getGoodsLots(pending.requested)} />
    </p>
    <div className="player-market__pending-actions">
      <IconButton
        caption={i18n._(M.market.retryOffer)}
        disabled={busy}
        icon="apply"
        label={i18n._(M.market.retryOfferLabel)}
        onClick={onRetry}
      />
      {pending.discardable && (
        <IconButton
          caption={i18n._(M.common.discard)}
          disabled={busy}
          icon="cancel"
          label={i18n._(M.market.discardOffer)}
          onClick={onDiscard}
        />
      )}
    </div>
    {!pending.discardable && (
      <p className="player-market__note">{i18n._(M.market.discardSafe)}</p>
    )}
  </section>
  );
};

interface PendingBuyCardProps {
  busy: boolean;
  pending: MarketPendingBuy;
  onDiscard: () => void;
  onRetry: () => void;
}
/** A purchase whose deposit or accept step is not confirmed; retry keeps the same server keys. */
export const PendingBuyCard = ({ busy, pending, onDiscard, onRetry }: PendingBuyCardProps) => {
  const { i18n } = useLingui();
  return (
  <section aria-label={i18n._(M.market.unfinishedBuy)} className="player-market__pending">
    <h3>{getPendingBuyTitle(pending, i18n)}</h3>
    <p>{getPendingBuyText(pending, i18n)}</p>
    <p className="player-market__pending-goods">
      <small>{i18n._(M.market.youGet)}</small><GoodsLots lots={getGoodsLots(pending.offered)} />
      <small>{i18n._(M.market.youGive)}</small><GoodsLots lots={getGoodsLots(pending.requested)} />
    </p>
    <div className="player-market__pending-actions">
      <IconButton
        caption={i18n._(M.market.retryBuy)}
        disabled={busy}
        icon="apply"
        label={i18n._(M.market.retryBuyLabel)}
        onClick={onRetry}
      />
      {pending.discardable && (
        <IconButton
          caption={i18n._(M.common.discard)}
          disabled={busy}
          icon="cancel"
          label={i18n._(M.market.discardBuy)}
          onClick={onDiscard}
        />
      )}
    </div>
    {!pending.discardable && (
      <p className="player-market__note">{i18n._(M.market.discardSafe)}</p>
    )}
  </section>
  );
};

interface PendingClaimCardProps {
  busy: boolean;
  pending: MarketPendingClaim;
  onDiscard: () => void;
  onRetry: () => void;
}
/** An explicit claim whose answer was lost; retrying it cannot withdraw the same goods twice. */
export const PendingClaimCard = ({ busy, pending, onDiscard, onRetry }: PendingClaimCardProps) => {
  const { i18n } = useLingui();
  return (
  <section aria-label={i18n._(M.market.unfinishedClaim)} className="player-market__pending">
    <h3>{getPendingClaimTitle(i18n)}</h3>
    <p>{getPendingClaimText(pending, i18n)}</p>
    <p className="player-market__pending-goods">
      <small>{i18n._(M.market.goods)}</small><GoodsLots lots={getGoodsLots(pending.goods)} />
    </p>
    <div className="player-market__pending-actions">
      <IconButton
        caption={i18n._(M.market.retryClaim)}
        disabled={busy}
        icon="apply"
        label={i18n._(M.market.retryClaimLabel)}
        onClick={onRetry}
      />
      <IconButton
        caption={i18n._(M.common.discard)}
        disabled={busy}
        icon="cancel"
        label={i18n._(M.market.discardClaim)}
        onClick={onDiscard}
      />
    </div>
  </section>
  );
};

interface MarketOffersProps {
  busy: boolean;
  offers: readonly MarketOfferRow[];
  onCancel: (tradeId: string) => void;
}
/** The player's open offers; the offered goods shown here are held in Market escrow, not home storage. */
export const MarketOffers = ({ busy, offers, onCancel }: MarketOffersProps) => {
  const { i18n } = useLingui();
  return (
  <section aria-label={i18n._(M.market.offerSectionAria)} className="player-market__section">
    <h3>{i18n._(M.market.openOffers)}</h3>
    <p className="player-market__note">{i18n._(M.market.openOffersNote)}</p>
    {offers.length > 0 && (
      <ul aria-label={i18n._(M.market.openOffersAria)} className="player-market__offer-list">
        {offers.map(offer => (
          <li className="player-market__offer" data-offer-id={offer.id} key={offer.id}>
            <div className="player-market__offer-side">
              <small>{i18n._(M.market.escrow)}</small>
              <GoodsLots lots={offer.give} />
            </div>
            <span aria-hidden="true" className="player-market__arrow">→</span>
            <div className="player-market__offer-side">
              <small>{i18n._(M.market.youRequest)}</small>
              <GoodsLots lots={offer.need} />
            </div>
            <small className="player-market__expiry">{offer.expiresText}</small>
            <IconButton
              caption={i18n._(M.market.cancel)}
              disabled={busy}
              icon="cancel"
              label={offer.cancelLabel}
              onClick={() => onCancel(offer.id)}
            />
          </li>
        ))}
      </ul>
    )}
    {offers.length === 0 && <p className="player-market__empty">{i18n._(M.market.noOffers)}</p>}
  </section>
  );
};

interface PlayerOffersProps {
  busy: boolean;
  offers: readonly MarketBuyRow[];
  onBuy: (tradeId: string) => void;
}
/** Other players' open offers: the offered goods arrive in the Market wallet for the requested goods. */
export const PlayerOffers = ({ busy, offers, onBuy }: PlayerOffersProps) => {
  const { i18n } = useLingui();
  return (
  <section aria-label={i18n._(M.market.playerOffersAria)} className="player-market__section">
    <h3>{i18n._(M.market.playerOffers)}</h3>
    <p className="player-market__note">{i18n._(M.market.playerOffersNote)}</p>
    {offers.length > 0 && (
      <ul aria-label={i18n._(M.market.playerOffersAria)} className="player-market__offer-list">
        {offers.map(offer => (
          <li className="player-market__offer" data-offer-id={offer.id} key={offer.id}>
            <div className="player-market__offer-side">
              <small>{i18n._(M.market.youGet)}</small>
              <GoodsLots lots={offer.get} />
            </div>
            <span aria-hidden="true" className="player-market__arrow">→</span>
            <div className="player-market__offer-side">
              <small>{i18n._(M.market.youGive)}</small>
              <GoodsLots lots={offer.give} />
            </div>
            <small className="player-market__expiry">{offer.expiresText}</small>
            <div className="player-market__buy-action">
              <IconButton
                caption={offer.actionLabel}
                disabled={busy || Boolean(offer.problem)}
                icon="market"
                label={offer.buttonLabel}
                onClick={() => onBuy(offer.id)}
              />
              {offer.problem && (
                <small className="player-market__buy-problem" role="status">{offer.problem}</small>
              )}
            </div>
          </li>
        ))}
      </ul>
    )}
    {offers.length === 0 && <p className="player-market__empty">{i18n._(M.market.noPlayerOffers)}</p>}
  </section>
  );
};
