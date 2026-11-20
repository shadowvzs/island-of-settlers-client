import { useLingui } from "@lingui/react";

import { translateMessage } from "../../../shared/i18n/translate";
import { useExternalStore } from "../../components/external-store";
import { createComponentMount } from "../../components/react-island";
import { isShallowEqual } from "../../components/ui-store";
import { PlayerItemIcon } from "../../player-inventory/item-icon";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiStore } from "../ui-store";
import { useWindowSelector } from "../use-window-selector";
import { DECORATION_SHOP_MESSAGES as M } from "./decoration-messages";
import { type DecorationPreviewActions, getDecorationPreviewOffer } from "./decoration-preview";
import { selectGemShopPlayer } from "./helpers";

import "./decoration-preview.css";

interface Options {
  actions: DecorationPreviewActions;
  store: SettlementUiStore;
  visibility: SettlementWindowVisibilityStore;
}
const usePreview = ({ actions, store, visibility }: Options) => {
  const { i18n } = useLingui();
  const id = useExternalStore(actions.selection);
  const { selection: player } = useWindowSelector(store, visibility, selectGemShopPlayer, isShallowEqual, i18n.locale);
  const offer = getDecorationPreviewOffer(id, player, i18n);
  return { offer, price: translateMessage(i18n, M.price, { price: offer?.price ?? "" }),
    onBuy: actions.buy, onCancel: actions.cancel };
};
const DecorationPreview = (options: Options) => {
  const { i18n } = useLingui();
  const { offer, price, onBuy, onCancel } = usePreview(options);
  if (!offer?.item) return null;
  return <div className="gem-shop-preview">
    <div className="gem-shop-preview__image"><PlayerItemIcon item={offer.item} /></div>
    <strong>{offer.description}</strong>
    <span>{offer.tierText}</span>
    <p>{price}</p>
    <div className="gem-shop-preview__actions">
      <button className="settlement-ui__button" disabled={offer.disabled} title={offer.buyLabel}
        type="button" onClick={onBuy}>{i18n._(M.buy)}</button>
      <button className="settlement-ui__button" type="button" onClick={onCancel}>{i18n._(M.cancel)}</button>
    </div>
  </div>;
};
export const createDecorationPreviewMount = (options: Options) => createComponentMount(DecorationPreview, options);
