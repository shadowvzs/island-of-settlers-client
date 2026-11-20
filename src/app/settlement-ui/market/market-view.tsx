import { useLingui } from "@lingui/react";

import { translateMessage } from "../../../shared/i18n/translate";
import { IconButton } from "../../components/icon-button";
import { formatWholeNumber } from "../helpers";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { MarketOfferForm } from "./market-offer-form";
import { MarketOffers, PendingBuyCard, PendingClaimCard, PendingOfferCard, PlayerOffers } from "./market-offers";
import { HomeStorage, MarketWallet } from "./market-storage";
import type { MarketViewState } from "./use-market";

const Unavailable = () => {
  const { i18n } = useLingui();
  return (
    <div aria-label={i18n._(M.market.unavailableAria)} className="player-market player-market--notice">
      <h3>{i18n._(M.market.unavailable)}</h3>
      <p>{i18n._(M.market.unavailableNote)}</p>
      <p>{i18n._(M.market.unavailableExtra)}</p>
    </div>
  );
};

const HomeOnly = () => {
  const { i18n } = useLingui();
  return (
    <div aria-label={i18n._(M.market.homeOnlyAria)} className="player-market player-market--notice">
      <h3>{i18n._(M.market.homeOnly)}</h3>
      <p>{i18n._(M.market.homeOnlyNote)}</p>
    </div>
  );
};

/** The combined Player Market screen: home stock, wallet claims, offers and the offer form. */
export const PlayerMarketView = (props: MarketViewState) => {
  const { i18n } = useLingui();
  if (!props.available) return <Unavailable />;
  if (!props.homeOnly) return <HomeOnly />;
  const actionsBusy = props.busy || props.loading;
  return (
    <div className="player-market">
      <div className="player-market__toolbar">
        <span>
          {props.loaded && translateMessage(i18n, M.market.walletCount, { count: formatWholeNumber(props.walletTotal) })}
          {!props.loaded && i18n._(M.market.reading)}
        </span>
        {props.loading && <small className="player-market__loading">{i18n._(M.market.refreshing)}</small>}
        <IconButton
          caption={i18n._(M.market.refresh)}
          disabled={props.busy || props.loading}
          icon="apply"
          label={i18n._(M.market.refreshLabel)}
          onClick={props.onRefresh}
        />
      </div>
      <p className="player-market__status" role="status">{props.status}</p>
      {props.error && <p className="player-market__error" role="alert">{props.error}</p>}
      {!props.loaded && !props.error && (
        <p className="player-market__empty">{i18n._(M.market.loading)}</p>
      )}
      {props.loaded && (
        <>
          <div className="player-market__columns">
            <HomeStorage rows={props.homeRows} />
            <MarketWallet
              busy={actionsBusy}
              rows={props.walletRows}
              onClaim={props.onClaim}
              onClaimAll={props.onClaimAll}
            />
          </div>
          {props.pendingClaim && (
            <PendingClaimCard
              busy={actionsBusy}
              pending={props.pendingClaim}
              onDiscard={props.onDiscardClaim}
              onRetry={props.onRetryClaim}
            />
          )}
          {props.pendingOffer && (
            <PendingOfferCard
              busy={actionsBusy}
              pending={props.pendingOffer}
              onDiscard={props.onDiscardOffer}
              onRetry={props.onRetryOffer}
            />
          )}
          {props.pendingBuy && (
            <PendingBuyCard
              busy={actionsBusy}
              pending={props.pendingBuy}
              onDiscard={props.onDiscardBuy}
              onRetry={props.onRetryBuy}
            />
          )}
          {!props.pendingOffer && (
            <MarketOfferForm
              busy={actionsBusy}
              form={props.form}
              onAmount={props.onAmount}
              onOffer={props.onOffer}
              onTtl={props.onTtl}
              onWare={props.onWare}
            />
          )}
          <MarketOffers busy={actionsBusy} offers={props.offers} onCancel={props.onCancel} />
          <PlayerOffers busy={actionsBusy} offers={props.buyRows} onBuy={props.onBuy} />
          <p className="player-market__footnote">{i18n._(M.market.footnote)}</p>
        </>
      )}
    </div>
  );
};
