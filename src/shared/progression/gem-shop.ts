import { categoriesOfKind, type OfferEntry, offerEntries, weaponToolKeys } from "@shared/catalog";
import { isMaterialAvailable, levelForExperience, materialMinimumLevel } from "@shared/catalog/balance";

import { playerItemForOfferId } from "../../../../island-of-settlers-shared/src/player-inventory";
import type { ResourceTier } from "../world/colony-resource-tiers";
import { OFFER_CATEGORY_PREFIX } from "./constants";
import { purchasePersonalItem } from "./personal-item-purchase";
import { CHOOSE_NATION_OFFER_ID, purchaseChooseNation } from "./player-inventory";
import type { PlayerProgress } from "./player-progress";

export type GemShopCategoryId = "military" | "resources" | "tools" | "items" | "decorations";
export interface GemShopCategory {
  id: GemShopCategoryId;
  label: string;
}
export interface GemShopOffer {
  id: string;
  category: GemShopCategoryId;
  ware: string;
  amount: number;
  /** Price in gems. */
  price: number;
  /** Building materials include the base resource tier0. */
  resourceTier?: ResourceTier;
}
export type GemPurchase =
  | { ok: true; progress: PlayerProgress; goods: Readonly<Record<string, number>> }
  | { ok: false; reason: string };

/** The gem shop tabs in display order: the catalog's offer categories, then personal items and decorations. */
export const GEM_SHOP_CATEGORIES: readonly GemShopCategory[] = [
  ...categoriesOfKind("offer").map(category => ({
    id: category.id.slice(OFFER_CATEGORY_PREFIX.length) as GemShopCategoryId, label: category.text.name.en
  })),
  { id: "items", label: "Items" },
  { id: "decorations", label: "Decorations" }
];

const toOffer = ({ category, key, offer }: OfferEntry): GemShopOffer => ({
  amount: offer.amount, category: category.slice(OFFER_CATEGORY_PREFIX.length) as GemShopCategoryId, id: key,
  price: offer.price, ...(offer.resourceTier === undefined ? {} : { resourceTier: offer.resourceTier as ResourceTier }),
  ware: offer.ware
});

/** Every gem shop ware bundle in shop order: a view over the catalog's `offer:*` entries. */
export const GEM_SHOP_OFFER_LIST: readonly GemShopOffer[] = offerEntries().map(toOffer);
/** Construction material bundles (one per material and resource tier). */
export const BUILDING_MATERIAL_OFFERS: readonly GemShopOffer[] =
  GEM_SHOP_OFFER_LIST.filter(offer => offer.resourceTier !== undefined);

/**
 * Owner rule (campaign plan item 20): the gem shop is closed on a campaign map, so bought goods never skip the
 * map's requirements. The API refuses with the same text.
 */
export const GEM_SHOP_CAMPAIGN_CLOSED = "The gem shop is closed on campaign maps";

/** Construction materials are always available; the shop is the owner-approved way to fill a gap. */
export const isGemShopOfferAvailable = (offer: GemShopOffer, playerLevel: number) =>
  offer.resourceTier !== undefined || isMaterialAvailable(offer.ware, playerLevel);

export const gemShopOffers = (category: GemShopCategoryId, playerLevel = 1) =>
  GEM_SHOP_OFFER_LIST.filter(offer => isGemShopOfferAvailable(offer, playerLevel) &&
    (offer.category === category || (category === "tools" && weaponToolKeys().includes(offer.ware))));

/** Pays an offer's gems; the caller stores the returned goods on the island. */
export const purchaseGemOffer = (progress: PlayerProgress, offerId: string, ownedOutsideInventory = 0): GemPurchase => {
  if (offerId === CHOOSE_NATION_OFFER_ID) {
    const purchase = purchaseChooseNation(progress);
    return purchase.ok ? { ...purchase, goods: {} } : purchase;
  }
  const personal=playerItemForOfferId(offerId);
  if (personal) {
    const purchase=purchasePersonalItem(progress,personal.id,ownedOutsideInventory);
    return purchase.ok ? { ...purchase,goods:{} } : purchase;
  }
  const offer = GEM_SHOP_OFFER_LIST.find(entry => entry.id === offerId);
  if (!offer) return { ok: false, reason: "This offer is not available" };
  if (!isGemShopOfferAvailable(offer, levelForExperience(progress.experience)))
    return { ok: false, reason: `Unlocks at player level ${materialMinimumLevel(offer.ware)}` };
  if (progress.gems < offer.price) return { ok: false, reason: `Needs ${offer.price - progress.gems} more gems` };
  const progressAfter = { ...progress, gems: progress.gems - offer.price };
  return { goods: { [offer.ware]: offer.amount }, ok: true, progress: progressAfter };
};

/** Development tool: gems without levelling up. */
export const grantGems = (progress: PlayerProgress, gems: number): PlayerProgress =>
  ({ ...progress, gems: progress.gems + Math.max(0, Math.round(gems)) });
