import { isMaterialAvailable, materialMinimumLevel, TRADE_MAX_LOT_AMOUNT } from "@shared/catalog/balance";

import { wareDisplayName } from "../settlement/ware-names";
import type { SettlementTradeSave, TradeCheck, TradeIslandView, TradeLot } from "./trade-types";
import { isNationTradable, isTradeLot, protectedFloor } from "./trade-values";

/** Player-facing reasons a trade command refuses (shown in the trade office's error dialog). */
export const TRADE_REASONS = Object.freeze({
  harbourMissing: "This island needs a harbour to trade",
  harbourUnfinished: "Finish the harbour before trading",
  homeOnly: "Trading is only available on your home island",
  invalidLot: "Choose a ware and a whole amount",
  offerExpired: "This offer is no longer available (expired)",
  offerInactive: "This offer is no longer active",
  offerTaken: "This offer was already taken",
  sameWare: "Offer and request must be different wares"
});
export const activeOfferLimitReason = (limit: number) => `You already have ${limit} active offers`;
export const levelLockedReason = (ware: string) =>
  `${wareDisplayName(ware)} unlocks at player level ${materialMinimumLevel(ware)}`;
export const notTradableReason = (ware: string) => `${wareDisplayName(ware)} cannot be traded`;
export const notEnoughStockReason = (lot: TradeLot, free: number) =>
  `Not enough free ${wareDisplayName(lot.ware)}: needs ${lot.amount}, ${Math.max(0, free)} free`;
export const protectedFloorReason = (ware: string, floor: number) =>
  `Trading keeps at least ${floor} ${wareDisplayName(ware)} in stock (protected)`;
export const capacityReason = (lot: TradeLot, room: number) =>
  `Request exceeds free storage for ${wareDisplayName(lot.ware)}: ${lot.amount} asked, room for ${Math.max(0, room)}`;
export const storageFullReason = (ware: string) => `Storage for ${wareDisplayName(ware)} is full`;

/** A switched-off trade office first (GS4a), then the home-island rule. */
const islandCheck = (view: TradeIslandView): TradeCheck => {
  if (view.featureOff) return view.featureOff;
  return view.homeIsland ? true : TRADE_REASONS.homeOnly;
};
const harbourCheck = (view: TradeIslandView): TradeCheck => {
  if (view.harbour === "missing") return TRADE_REASONS.harbourMissing;
  return view.harbour === "unfinished" ? TRADE_REASONS.harbourUnfinished : true;
};
const levelCheck = (view: TradeIslandView, ...lots: TradeLot[]): TradeCheck => {
  const locked = lots.find(lot => !isMaterialAvailable(lot.ware, view.playerLevel));
  return locked ? levelLockedReason(locked.ware) : true;
};
/** The island pays `lot` from free stock and keeps the protected floor. */
const paymentCheck = (view: TradeIslandView, floors: SettlementTradeSave["floors"], lot: TradeLot): TradeCheck => {
  const free = view.freeStock(lot.ware);
  if (free < lot.amount) return notEnoughStockReason(lot, free);
  const floor = protectedFloor(floors, lot.ware);
  return free - lot.amount < floor ? protectedFloorReason(lot.ware, floor) : true;
};
/** Owner rule: no new order while the island's stock of the delivered ware is at its storage limit. */
const capacityCheck = (view: TradeIslandView, lot: TradeLot): TradeCheck => {
  if (view.storageFull(lot.ware)) return storageFullReason(lot.ware);
  const room = view.freeCapacity(lot.ware);
  return lot.amount > room ? capacityReason(lot, room) : true;
};
/** The first failing check, or true. */
const firstFailure = (...checks: (() => TradeCheck)[]): TradeCheck => {
  for (const check of checks) {
    const result = check();
    if (result !== true) return result;
  }
  return true;
};

/**
 * Buy: the offer is open today, the harbour ready, both wares unlocked, payment free, the delivered ware's
 * storage not full and the delivery fits.
 */
export const validateMerchantBuy = (
  state: SettlementTradeSave, view: TradeIslandView, offerId: string
): TradeCheck => {
  // Off the home island (or with trading off) there is no market at all: say so rather than "expired".
  const island = islandCheck(view);
  if (island !== true) return island;
  const offer = state.market?.offers.find(entry => entry.id === offerId);
  if (!offer) return TRADE_REASONS.offerExpired;
  if (offer.status === "taken") return TRADE_REASONS.offerTaken;
  return firstFailure(() => harbourCheck(view), () => levelCheck(view, offer.give, offer.want),
    () => paymentCheck(view, state.floors, offer.want), () => capacityCheck(view, offer.give));
};

const lotCheck = (lot: unknown, nation: string): TradeCheck => {
  const ware = (lot as TradeLot | null)?.ware;
  if (typeof ware === "string" && ware && !isNationTradable(ware, nation)) return notTradableReason(ware);
  return isTradeLot(lot, TRADE_MAX_LOT_AMOUNT) ? true : TRADE_REASONS.invalidLot;
};

/** The account's limit: trading exists only on the home island, so its offers are all of the account's. */
const activeOfferCheck = (state: SettlementTradeSave, limit: number): TradeCheck =>
  state.offers.length >= limit ? activeOfferLimitReason(limit) : true;

/**
 * Place: valid distinct lots, home island with a ready harbour, below the account's active-offer limit, payment free, the wanted
 * ware's storage not full and the request fits.
 */
export const validatePlaceOffer = (
  state: SettlementTradeSave, view: TradeIslandView, give: unknown, want: unknown
): TradeCheck => {
  const island = islandCheck(view);
  if (island !== true) return island;
  const lots = firstFailure(() => lotCheck(give, view.nation), () => lotCheck(want, view.nation));
  if (lots !== true) return lots;
  const gave = give as TradeLot, wanted = want as TradeLot;
  if (gave.ware === wanted.ware) return TRADE_REASONS.sameWare;
  return firstFailure(() => harbourCheck(view),
    () => activeOfferCheck(state, view.offerLimit),
    () => levelCheck(view, gave, wanted), () => paymentCheck(view, state.floors, gave),
    () => capacityCheck(view, wanted));
};

/** Cancel: only an active own offer (a filled or cancelled one is gone). Its wares return at the harbour. */
export const validateCancelOffer = (state: SettlementTradeSave, view: TradeIslandView, offerId: string): TradeCheck => {
  const island = islandCheck(view);
  if (island !== true) return island;
  return state.offers.some(offer => offer.id === offerId) ? true : TRADE_REASONS.offerInactive;
};
