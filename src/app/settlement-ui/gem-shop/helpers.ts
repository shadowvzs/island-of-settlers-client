import type { I18n } from "@lingui/core";
import { itemEntries } from "@shared/catalog";

import {
  isPlayerItemAvailableForPurchase, playerItemDefinition, type PlayerItemId
} from "../../../../../island-of-settlers-shared/src/player-inventory";
import { type DecorationShopCategory, ROAD_DECORATION_ITEM_DEFINITIONS } from "../../../../../island-of-settlers-shared/src/road-decoration-items";
import { translateDomainText } from "../../../shared/i18n/domain";
import { translateMessage } from "../../../shared/i18n/translate";
import {
  GEM_SHOP_CAMPAIGN_CLOSED, GEM_SHOP_CATEGORIES, type GemShopOffer, gemShopOffers
} from "../../../shared/progression/gem-shop";
import { getTabIds } from "../../components/helpers";
import { playerItemName } from "../../player-inventory/item-presentation";
import { INVENTORY_MESSAGES } from "../../player-inventory/messages";
import { formatWareCount } from "../helpers";
import { formatWholeNumber } from "../helpers";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementUiOptions, SettlementUiSnapshot } from "../types";
import { DECORATION_SHOP_MESSAGES as D } from "./decoration-messages";

export const GEM_SHOP_PANEL_ID = "gem-shop-offers";
export const getGemShopSuccess = (i18n?: I18n, categoryIndex = 0) =>
  translateMessage(i18n, ["items", "decorations"].includes(GEM_SHOP_CATEGORIES[categoryIndex]?.id ?? "")
    ? INVENTORY_MESSAGES.purchaseAdded : M.gemShop.success);

const CATEGORY_LABELS = {
  decorations: D.category,
  items: INVENTORY_MESSAGES.items,
  military: M.gemShop.categoryMilitary,
  resources: M.gemShop.categoryResources,
  tools: M.gemShop.categoryTools
} as const;

/**
 * What the shop depends on: the gem balance (affordability), the level (non-material offers) and whether the
 * island on screen is a campaign map (the shop is closed there).
 */
export const selectGemShopPlayer = ({ islandRole, player }: SettlementUiSnapshot) => ({
  closed: islandRole === "campaign", gems: player?.gems ?? 0, inventory: player?.inventory, level: player?.level ?? 1
});

export interface GemShopPlayer {
  closed?: boolean;
  gems: number;
  inventory?: import("../../../shared/progression/player-inventory").PlayerInventory;
  level: number;
}

/** Why every offer is disabled (a campaign map); empty while the shop is open. */
export const getGemShopClosedReason = ({ closed }: GemShopPlayer, i18n?: I18n) =>
  closed ? translateDomainText(GEM_SHOP_CAMPAIGN_CLOSED, i18n) : "";

/** Category tabs with ids, selection and the roving tab index. */
export const getGemShopTabs = (activeIndex: number, i18n?: I18n) => GEM_SHOP_CATEGORIES.map(({ id }, index) => ({
  id,
  index,
  label: translateMessage(i18n, CATEGORY_LABELS[id]),
  selected: index === activeIndex,
  tabId: getTabIds("gem-shop", id).tabId,
  tabIndex: index === activeIndex ? 0 : -1
}));

export const DECORATION_SHOP_TYPES: readonly DecorationShopCategory[] = ["arches", "plants", "trees", "lanterns", "columns"];
export const getGemShopDecorationTabs = (activeIndex: number, i18n?: I18n) => DECORATION_SHOP_TYPES.map((id, index) => ({
  id, index, label: translateMessage(i18n, D[id]), selected: index === activeIndex,
  tabId: getTabIds("gem-shop-decoration", id).tabId, tabIndex: index === activeIndex ? 0 : -1
}));

const getBuyLabel = (player: GemShopPlayer, price: number, wares: string, i18n?: I18n) =>
  getGemShopClosedReason(player, i18n) || translateMessage(i18n, M.gemShop.purchase, { price, wares });

const getOfferCard = (offer: GemShopOffer, player: GemShopPlayer, i18n?: I18n) => {
  const description = formatWareCount(offer.amount, offer.ware);
  return {
    buyLabel: getBuyLabel(player, offer.price, description, i18n),
    description,
    disabled: Boolean(player.closed) || player.gems < offer.price,
    id: offer.id,
    item: undefined,
    price: formatWholeNumber(offer.price),
    resourceTier: offer.resourceTier,
    tierText: offer.resourceTier === undefined ? undefined
      : translateMessage(i18n, M.gemShop.tier, { tier: offer.resourceTier }),
    ware: offer.ware
  };
};

/** Offers of a category available to the player; construction materials are never level-gated. */
const getItemCard = (item:PlayerItemId,player:GemShopPlayer,i18n?:I18n) => {
  const definition=playerItemDefinition(item)!;
  const description=playerItemName(item,i18n);
  const owned=player.inventory?.[item] ?? 0;
  return {
    buyLabel:getBuyLabel(player,definition.price,description,i18n),description,
    disabled:Boolean(player.closed) || player.gems<definition.price || owned>=definition.maxHeld,
    id:definition.offerId,item,
    price:formatWholeNumber(definition.price),resourceTier:undefined,
    tierText:translateMessage(i18n,INVENTORY_MESSAGES.owned,{ count:owned }),ware:undefined
  };
};
export const getGemShopOfferCards = (categoryIndex: number, player: GemShopPlayer, i18n?: I18n,
  decorationType: DecorationShopCategory = "arches") => {
  const category = GEM_SHOP_CATEGORIES[categoryIndex]!.id;
  if (category === "items") return itemEntries().map(entry => getItemCard(entry.key, player, i18n));
  if (category === "decorations") return (Object.keys(ROAD_DECORATION_ITEM_DEFINITIONS) as (keyof typeof ROAD_DECORATION_ITEM_DEFINITIONS)[])
    .filter(item => ROAD_DECORATION_ITEM_DEFINITIONS[item]!.category === decorationType && isPlayerItemAvailableForPurchase(item))
    .map(item => getItemCard(item, player, i18n));
  return gemShopOffers(category, player.level).map(offer => getOfferCard(offer, player, i18n));
};

export type GemShopOfferCard = ReturnType<typeof getOfferCard> | ReturnType<typeof getItemCard>;

/** Buys an offer synchronously: true, or the reason it was refused. */
export const buyGemOffer = (
  { onBuyGemOffer }: Pick<SettlementUiOptions, "onBuyGemOffer">, id: string, i18n?: I18n
) => onBuyGemOffer?.(id) ?? translateMessage(i18n, M.gemShop.unavailable);
