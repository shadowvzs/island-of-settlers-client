import { useLingui } from "@lingui/react";
import { type KeyboardEvent, useState } from "react";

import { isShallowEqual } from "../../components/ui-store";
import { selectTabByKey } from "../../components/use-tabs";
import { formatWholeNumber } from "../helpers";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiOptions } from "../types";
import type { SettlementUiStore } from "../ui-store";
import { useWindowSelector } from "../use-window-selector";
import {
  buyGemOffer, DECORATION_SHOP_TYPES, getGemShopClosedReason, getGemShopDecorationTabs, getGemShopOfferCards,
  getGemShopSuccess, getGemShopTabs, selectGemShopPlayer
} from "./helpers";
import { settleGemShopPurchase } from "./purchase-notification";

/**
 * Category tabs and offer cards. Purchases report their final outcome through the toast service.
 * The shop reopens on the last category.
 */
export const useGemShop = (
  store: SettlementUiStore, visibility: SettlementWindowVisibilityStore,
  options: Pick<SettlementUiOptions, "onBuyGemOffer"> & { onPreviewDecoration: (id: string) => void }
) => {
  const { i18n } = useLingui();
  const { selection: player } = useWindowSelector(
    store, visibility, selectGemShopPlayer, isShallowEqual, i18n.locale);
  const [categoryIndex, setCategoryIndex] = useState(0);
  const [decorationIndex, setDecorationIndex] = useState(0);
  const success = getGemShopSuccess(i18n, categoryIndex);
  const tabs = getGemShopTabs(categoryIndex, i18n);
  const decorationTabs = tabs[categoryIndex]?.id === "decorations" ? getGemShopDecorationTabs(decorationIndex, i18n) : [];
  return {
    activeTabId: tabs[categoryIndex]!.tabId,
    balance: formatWholeNumber(player.gems),
    closedReason: getGemShopClosedReason(player, i18n),
    offers: getGemShopOfferCards(categoryIndex, player, i18n, DECORATION_SHOP_TYPES[decorationIndex]),
    decorationTabs,
    onDecorationTabSelect: setDecorationIndex,
    onDecorationTabKeyDown: (event: KeyboardEvent<HTMLButtonElement>, index: number) =>
      selectTabByKey(event, index, decorationTabs, setDecorationIndex),
    tabs,
    onBuy: (id: string) => {
      if (tabs[categoryIndex]?.id === "decorations") {
        options.onPreviewDecoration(id);
        return;
      }
      settleGemShopPurchase(buyGemOffer(options, id, i18n), success, i18n);
    },
    onTabKeyDown: (event: KeyboardEvent<HTMLButtonElement>, index: number) =>
      selectTabByKey(event, index, tabs, setCategoryIndex),
    onTabSelect: setCategoryIndex
  };
};
