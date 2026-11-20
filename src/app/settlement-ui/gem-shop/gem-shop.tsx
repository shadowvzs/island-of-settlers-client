import { useLingui } from "@lingui/react";
import type { KeyboardEvent } from "react";

import { WareIcon } from "../../components/ware-icon";
import { PlayerItemIcon } from "../../player-inventory/item-icon";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { progressionIcon } from "../player-hud-helpers";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiOptions } from "../types";
import type { SettlementUiStore } from "../ui-store";
import { DECORATION_SHOP_MESSAGES as D } from "./decoration-messages";
import { GEM_SHOP_PANEL_ID, type GemShopOfferCard, type getGemShopTabs } from "./helpers";
import { useGemShop } from "./use-gem-shop";

import "./decoration-tabs.css";

const GemImage = () => (
  <img alt="" className="gem-shop__gem" draggable={false} src={progressionIcon("gem")} />
);

interface OfferCardProps {
  offer: GemShopOfferCard;
  onBuy: (id: string) => void;
}
const OfferIcon = ({ offer }: { offer: GemShopOfferCard }) => {
  if (offer.item !== undefined) return <PlayerItemIcon item={offer.item} />;
  return <WareIcon ware={offer.ware} />;
};
const OfferCard = ({ offer, onBuy }: OfferCardProps) => (
  <article
    className="settlement-ui__card gem-shop__offer"
    data-offer-id={offer.id}
    data-resource-tier={offer.resourceTier}
  >
    <OfferIcon offer={offer} />
    <span>
      {offer.description}
      {offer.tierText && <><br /><small>{offer.tierText}</small></>}
    </span>
    <button
      aria-label={offer.buyLabel}
      className="settlement-ui__button gem-shop__buy"
      disabled={offer.disabled}
      title={offer.buyLabel}
      type="button"
      onClick={() => onBuy(offer.id)}
    >
      <GemImage />
      <span>{offer.price}</span>
    </button>
  </article>
);

interface GemShopViewProps {
  decorationTabs: ReturnType<typeof useGemShop>["decorationTabs"];
  onDecorationTabSelect: (index: number) => void;
  onDecorationTabKeyDown: (event: KeyboardEvent<HTMLButtonElement>, index: number) => void;
  activeTabId: string;
  balance: string;
  /** Shown above the offers when the shop is closed (a campaign map). */
  closedReason: string;
  offers: readonly GemShopOfferCard[];
  tabs: ReturnType<typeof getGemShopTabs>;
  onBuy: (id: string) => void;
  onTabKeyDown: (event: KeyboardEvent<HTMLButtonElement>, index: number) => void;
  onTabSelect: (index: number) => void;
}
const GemShopView = ({
  activeTabId, balance, closedReason, offers, tabs, onBuy, onTabKeyDown, onTabSelect,
  decorationTabs, onDecorationTabSelect, onDecorationTabKeyDown
}: GemShopViewProps) => {
  const { i18n } = useLingui();
  let offerRole: "tabpanel" | undefined;
  if (decorationTabs.length) offerRole = "tabpanel";
  return (
  <>
    <div aria-label={i18n._(M.gemShop.categories)} className="gem-shop__categories" role="tablist">
      {tabs.map(tab => (
        <button
          aria-controls={GEM_SHOP_PANEL_ID}
          aria-selected={tab.selected}
          className="settlement-ui__tab gem-shop__category"
          id={tab.tabId}
          key={tab.id}
          role="tab"
          tabIndex={tab.tabIndex}
          type="button"
          onClick={() => onTabSelect(tab.index)}
          onKeyDown={event => onTabKeyDown(event, tab.index)}
        >
          {tab.label}
        </button>
      ))}
    </div>
    <div aria-labelledby={activeTabId} className="gem-shop__catalog" id={GEM_SHOP_PANEL_ID} role="tabpanel">
      {decorationTabs.length > 0 && <div aria-label={i18n._(D.types)} className="gem-shop__decoration-tabs" role="tablist">
        {decorationTabs.map(tab => <button aria-controls="gem-shop-decoration-offers" aria-selected={tab.selected}
          className="settlement-ui__tab" id={tab.tabId} key={tab.id} role="tab" tabIndex={tab.tabIndex} type="button"
          onClick={() => onDecorationTabSelect(tab.index)} onKeyDown={event => onDecorationTabKeyDown(event, tab.index)}>{tab.label}</button>)}
      </div>}
      <div aria-labelledby={decorationTabs.find(tab => tab.selected)?.tabId} className="gem-shop__offers"
        id="gem-shop-decoration-offers" role={offerRole}>
        {closedReason && <p className="gem-shop__closed" role="status">{closedReason}</p>}
        {offers.map(offer => <OfferCard key={offer.id} offer={offer} onBuy={onBuy} />)}
        {!offers.length && decorationTabs.length > 0 && <p className="gem-shop__empty">{i18n._(D.empty)}</p>}
      </div>
    </div>
    <p className="gem-shop__balance">
      {i18n._(M.gemShop.yourGems)}
      <GemImage />
      {balance}
    </p>
  </>
  );
};

interface GemShopProps {
  options: Pick<SettlementUiOptions, "onBuyGemOffer"> & { onPreviewDecoration: (id: string) => void };
  store: SettlementUiStore;
  visibility: SettlementWindowVisibilityStore;
}
/** Gem shop: categories on the left, offers on the right; goods arrive in the home storage. */
export const GemShop = ({ options, store, visibility }: GemShopProps) => (
  <GemShopView {...useGemShop(store, visibility, options)} />
);
