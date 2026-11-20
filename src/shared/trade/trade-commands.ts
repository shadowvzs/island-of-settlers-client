import { TRADE_OFFER_LIFETIME_MS, TRADE_PROTECTED_FLOORS } from "@shared/catalog/balance";

import { generateMerchantMarket, marketDay } from "./merchant-offers";
import { npcBuyerFillAt } from "./npc-buyer";
import { returnEscrow } from "./trade-escrow";
import {
  addDelivery, addEscrow, addHistory, lotGoods, nextTradeId, removeById
} from "./trade-ledger";
import type { PlayerOffer, SettlementTradeSave, TradeCheck, TradeIslandPort, TradeLot } from "./trade-types";
import {
  notEnoughStockReason, validateCancelOffer, validateMerchantBuy, validatePlaceOffer
} from "./trade-validation";
import { isTradableWare } from "./trade-values";

/**
 * Trade commands: each re-validates at execution time, then reserves the payment atomically (the whole payment
 * leaves free stock into an escrow staged in the harbour's pool custody, or nothing happens) and records
 * history with a wall-clock time.
 */
export const buyMerchantOffer = (state: SettlementTradeSave, port: TradeIslandPort, offerId: string): TradeCheck => {
  const check = validateMerchantBuy(state, port, offerId);
  if (check !== true) return check;
  const offer = state.market!.offers.find(entry => entry.id === offerId)!;
  const reservation = port.reserve(lotGoods(offer.want));
  if (!reservation) return notEnoughStockReason(offer.want, port.freeStock(offer.want.ware));
  offer.status = "taken";
  const escrow = addEscrow(state, "purchase", offer.id, lotGoods(offer.want), reservation);
  addDelivery(state, "purchase", offer.id, lotGoods(offer.give), escrow.id);
  addHistory(state, { at: port.now(), gave: { ...offer.want }, kind: "bought", merchant: offer.merchant,
    received: { ...offer.give } });
  return true;
};

export const placePlayerOffer = (
  state: SettlementTradeSave, port: TradeIslandPort, give: unknown, want: unknown
): TradeCheck => {
  const check = validatePlaceOffer(state, port, give, want);
  if (check !== true) return check;
  const gave = { ...(give as TradeLot) }, wanted = { ...(want as TradeLot) };
  const reservation = port.reserve(lotGoods(gave));
  if (!reservation) return notEnoughStockReason(gave, port.freeStock(gave.ware));
  const id = nextTradeId(state, "o");
  const escrow = addEscrow(state, "offer", id, lotGoods(gave), reservation);
  state.offers.push({ escrowId: escrow.id, fillAt: npcBuyerFillAt(port.seed, id, state.buyerClock, gave, wanted),
    give: gave, id, placedAt: state.elapsed, placedTime: port.now(), want: wanted });
  return true;
};

/**
 * Cancel: the offer's wares never left the island, so they return physically: held wares stay in their
 * storages, wares in the harbour's trade stock enter the harbour's pool.
 */
export const cancelPlayerOffer = (state: SettlementTradeSave, port: TradeIslandPort, offerId: string): TradeCheck => {
  const check = validateCancelOffer(state, port, offerId);
  if (check !== true) return check;
  const offer = state.offers.find(entry => entry.id === offerId)!;
  const escrow = state.escrow.find(entry => entry.id === offer.escrowId);
  if (escrow && !returnEscrow(escrow, port)) return "The paid trade storage is no longer available";
  removeById(state.offers, offerId);
  removeById(state.escrow, offer.escrowId);
  addHistory(state, { at: port.now(), gave: { ...offer.give }, kind: "cancelled" });
  return true;
};

/**
 * Trading exists only on the home island (owner 2026-10-19). A colony or adventure island loaded with trade
 * state from an older build gets every escrow back into its own storage (refund); its trade state is dropped.
 */
export const foldIslandTrade = (state: SettlementTradeSave, port: TradeIslandPort) => {
  const refunded = new Set<string>();
  state.escrow = state.escrow.filter(escrow => {
    if (!returnEscrow(escrow, port)) return true;
    refunded.add(escrow.id);
    return false;
  });
  state.offers = state.offers.filter(offer => !refunded.has(offer.escrowId));
  state.deliveries = state.deliveries.filter(delivery => !delivery.escrowId || !refunded.has(delivery.escrowId));
  return state.escrow.length === 0;
};

/**
 * Owner rule 2026-10-19: offer and request are always different wares. A loaded save breaking it (none should
 * exist) loses such merchant offers, and such own offers are cancelled with their wares returned.
 */
export const dropSameWareOffers = (state: SettlementTradeSave, port: TradeIslandPort) => {
  if (state.market) state.market.offers = state.market.offers.filter(offer => offer.give.ware !== offer.want.ware);
  cancelOffersWhere(state, port, offer => offer.give.ware === offer.want.ware);
};

/** Cancels the matching own offers like the Cancel button: their wares return, the history says cancelled. */
const cancelOffersWhere = (
  state: SettlementTradeSave, port: TradeIslandPort, matches: (offer: PlayerOffer) => boolean
) => {
  for (const offer of state.offers.filter(matches)) {
    const escrow = state.escrow.find(entry => entry.id === offer.escrowId);
    if (escrow && !returnEscrow(escrow, port)) continue;
    removeById(state.offers, offer.id);
    removeById(state.escrow, offer.escrowId);
    addHistory(state, { at: port.now(), gave: { ...offer.give }, kind: "cancelled" });
  }
};

/**
 * Trading switched off by the game rules (GS4a, plan §8.7): open own offers are refunded as if cancelled.
 * Purchases and sales already paid keep shipping; nothing else is deleted, so switching back is lossless.
 */
export const refundOffersWhileOff = (state: SettlementTradeSave, port: TradeIslandPort) => {
  if (!port.featureOff || !state.offers.length) return;
  cancelOffersWhere(state, port, () => true);
};

export const setProtectedFloor = (state: SettlementTradeSave, ware: unknown, amount: unknown): boolean => {
  if (!isTradableWare(ware) || !Number.isSafeInteger(amount) || (amount as number) < 0) return false;
  if (amount === (TRADE_PROTECTED_FLOORS[ware] ?? 0)) delete state.floors[ware];
  else state.floors[ware] = amount as number;
  return true;
};

/**
 * Debug-menu "NPC traders" (journalled): NPC buyers fill own offers only while on. Their clock pauses while
 * off, so switching on never fills retroactively: an offer fills once the buyer clock has run its delay.
 */
export const setNpcTraders = (state: SettlementTradeSave, enabled: unknown): boolean => {
  if (typeof enabled !== "boolean") return false;
  state.npcTraders = enabled;
  return true;
};

const offerExpiresAt = (offer: PlayerOffer) => offer.placedTime + TRADE_OFFER_LIFETIME_MS;

/** Game time a due offer was filled at: its fill time on the buyer clock, dated back from now. */
const filledTime = (state: SettlementTradeSave, port: TradeIslandPort, offer: PlayerOffer) =>
  port.now() - Math.round(Math.max(0, state.buyerClock - offer.fillAt!) * 1000);

/**
 * An NPC buyer takes the offer at its fill time (also when an offline catch-up passes it later): its escrow
 * becomes the sale the ship carries away, the wanted wares a delivery; the history dates it back to that time.
 */
const fillOffer = (state: SettlementTradeSave, port: TradeIslandPort, offer: PlayerOffer, fillAt: number) => {
  removeById(state.offers, offer.id);
  const escrow = state.escrow.find(entry => entry.id === offer.escrowId);
  if (escrow) escrow.purpose = "sale";
  const ago = Math.max(0, state.buyerClock - fillAt);
  // Whole milliseconds: one offline jump and many small ticks date the delivery identically.
  const createdAt = Math.round((state.elapsed - ago) * 1000) / 1000;
  addDelivery(state, "sale", offer.id, lotGoods(offer.want), escrow?.id, createdAt);
  addHistory(state, { at: filledTime(state, port, offer), gave: { ...offer.give }, kind: "sold",
    received: { ...offer.want } });
};

/**
 * An own offer nobody filled within its lifetime (12 h real time) expires: its wares return like a cancel's and
 * the history shows it expired at its expiry time.
 */
const expireOffer = (state: SettlementTradeSave, port: TradeIslandPort, offer: PlayerOffer) => {
  const escrow = state.escrow.find(entry => entry.id === offer.escrowId);
  if (escrow && !returnEscrow(escrow, port)) return;
  removeById(state.offers, offer.id);
  removeById(state.escrow, offer.escrowId);
  addHistory(state, { at: offerExpiresAt(offer), gave: { ...offer.give }, kind: "expired" });
};

/**
 * Advances the trade clock (market days) and, while NPC traders are on, the buyer clock: every own offer whose
 * fill time passed is filled in fill-time order, however long the step (offline catch-up gives the same result).
 * An offer whose fill time came after its expiry expires instead. `onSold` hears each filled offer (script event).
 */
export const updateTrade = (
  state: SettlementTradeSave, port: TradeIslandPort, dt: number, onSold?: (offer: PlayerOffer) => void
) => {
  // Trading exists only on the home island and while the game rules allow it: no market, no buyers elsewhere.
  if (!port.homeIsland || port.featureOff) return;
  const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
  state.elapsed += step;
  if (state.npcTraders) state.buyerClock += step;
  const day = marketDay(state.elapsed);
  if (state.market?.day !== day) state.market = generateMerchantMarket(port.seed, day, port.playerLevel, port.nation, port.tierCap);
  const due = state.offers.filter(offer => offer.fillAt !== null && offer.fillAt <= state.buyerClock)
    .sort((a, b) => a.fillAt! - b.fillAt! || a.placedAt - b.placedAt);
  for (const offer of due) {
    if (filledTime(state, port, offer) >= offerExpiresAt(offer)) continue;
    fillOffer(state, port, offer, offer.fillAt!);
    onSold?.(offer);
  }
  const now = port.now();
  for (const offer of state.offers.filter(entry => offerExpiresAt(entry) <= now)) expireOffer(state, port, offer);
};
