import type { I18n } from "@lingui/core";

import { getRoadDecorationItem, ROAD_DECORATION_ITEM_DEFINITIONS } from "../../../../../island-of-settlers-shared/src/road-decoration-items";
import { translateMessage } from "../../../shared/i18n/translate";
import { GEM_SHOP_CATEGORIES } from "../../../shared/progression/gem-shop";
import { createExternalStore } from "../../components/ui-store";
import { INVENTORY_MESSAGES } from "../../player-inventory/messages";
import type { SettlementUiOptions } from "../types";
import type { SettlementUiStore } from "../ui-store";
import { buyGemOffer, type GemShopPlayer, getGemShopOfferCards, selectGemShopPlayer } from "./helpers";
import { settleGemShopPurchase } from "./purchase-notification";

/** Rebuild from authoritative balance/custody, rather than keeping an obsolete offer card. */
export const getDecorationPreviewOffer = (id: string | undefined, player: GemShopPlayer, i18n?: I18n) => {
  if (!id) return;
  const categoryIndex = GEM_SHOP_CATEGORIES.findIndex(category => category.id === "decorations");
  const definition = Object.values(ROAD_DECORATION_ITEM_DEFINITIONS).find(item => item.offerId === id);
  if (!definition) return;
  return getGemShopOfferCards(categoryIndex, player, i18n, definition.category).find(offer => offer.id === id);
};

/** Selecting/cancelling never submits. Consume the selection synchronously before a purchase. */
export const createDecorationPreviewActions = (
  store: SettlementUiStore, options: Pick<SettlementUiOptions, "onBuyGemOffer">,
  close: () => void, i18n?: I18n
) => {
  const selection = createExternalStore<string | undefined>(undefined);
  const cancel = () => { selection.set(undefined); close(); };
  return {
    cancel,
    selection,
    select: (id: string) => {
      const offer = getDecorationPreviewOffer(id, selectGemShopPlayer(store.getSnapshot()), i18n);
      if (!offer?.item || !getRoadDecorationItem(offer.item)) return false;
      selection.set(id);
      return true;
    },
    buy: () => {
      const offer = getDecorationPreviewOffer(selection.getSnapshot(), selectGemShopPlayer(store.getSnapshot()), i18n);
      if (!offer || offer.disabled) return;
      cancel();
      settleGemShopPurchase(buyGemOffer(options, offer.id, i18n),
        translateMessage(i18n, INVENTORY_MESSAGES.purchaseAdded), i18n);
    }
  };
};
export type DecorationPreviewActions = ReturnType<typeof createDecorationPreviewActions>;
