import { MARKET_MAX_OPEN_OFFERS, MARKET_OFFER_TTL_SECONDS, MARKET_WARES } from "@shared/catalog/balance";

import type { StockGoods, StockWallet } from "./stock-move";

/**
 * The Market screen's wares (owner 2026-11-11: it stays at these 12 wares, it is only a multiplayer mock), TTLs and
 * the open-order limit are shared balance data; the API itself accepts every tradable catalog ware.
 */
export { MARKET_MAX_OPEN_OFFERS, MARKET_OFFER_TTL_SECONDS, MARKET_WARES };
export type MarketWare = string;

const MARKET_WARE_SET = new Set<string>(MARKET_WARES);

export const isMarketWare = (ware: string): ware is MarketWare => MARKET_WARE_SET.has(ware);

/**
 * The allowed, positive part of a goods map in the allowlist's stable order. Island and wallet stock can carry
 * other wares; they are deliberately not Market goods and the screen does not pretend that they are tradable.
 */
export const marketGoods = (goods: Readonly<Record<string, number>> | undefined): StockGoods => {
  if (!goods) return {};
  const allowed: StockGoods = {};
  for (const ware of MARKET_WARES) {
    const count = goods[ware];
    if (typeof count === "number" && Number.isSafeInteger(count) && count > 0) allowed[ware] = count;
  }
  return allowed;
};

export const isMarketGoods = (goods: Readonly<Record<string, number>>): boolean => {
  const entries = Object.entries(goods);
  return entries.length > 0 && entries.every(([ware, count]) =>
    isMarketWare(ware) && Number.isSafeInteger(count) && count > 0);
};

/** Stable identity of a goods map for a persisted idempotent claim (allowlist order, no object-key surprises). */
export const goodsSignature = (goods: Readonly<Record<string, number>>) =>
  MARKET_WARES.flatMap(ware => {
    const count = goods[ware];
    if (!Number.isSafeInteger(count) || (count ?? 0) <= 0) return [];
    return [`${ware}:${count}`];
  }).join(",");

/** One server Market order (docs/server/economy.md); amounts are integers of the shared ware allowlist. */
export interface MarketTrade {
  buyer_id: string | null;
  expires_at: string;
  /** Computed by the single-trade lock query; list responses omit it, so the client also checks expires_at. */
  expired?: boolean;
  id: string;
  offered: StockGoods;
  recipient_id: string | null;
  requested: StockGoods;
  seller_id: string;
  status: string;
}

/** What the player asks the Market to offer: goods leave the home storage and are held in escrow. */
export interface MarketOfferDraft {
  offered: StockGoods;
  requested: StockGoods;
  ttlSeconds: number;
}

/**
 * A combined offer whose two server steps are not atomic. `stage` is `deposit` until the goods are confirmed in
 * the Market wallet, then `trade` while only creating the escrow remains. The keys are reused on every retry.
 */
export interface MarketPendingOffer {
  /** Whether discarding is safe: false only while an unconfirmed deposit might still have reached the server. */
  discardable: boolean;
  depositKey: string;
  id: string;
  message: string;
  offered: StockGoods;
  requested: StockGoods;
  stage: "deposit" | "trade";
  tradeKey: string;
  ttlSeconds: number;
}

/** An explicit withdrawal whose response was not confirmed; retrying it with the same key cannot withdraw twice. */
export interface MarketPendingClaim {
  goods: StockGoods;
  id: string;
  key: string;
  message: string;
}

/**
 * A purchase whose two server steps are not atomic. `stage` is `deposit` until the requested goods are confirmed
 * in the Market wallet, then `accept` while only accepting the order remains. The keys are reused on every retry.
 */
export interface MarketPendingBuy {
  /** Whether discarding is safe: false only while an unconfirmed deposit might still have reached the server. */
  discardable: boolean;
  acceptKey: string;
  depositKey: string;
  id: string;
  message: string;
  offered: StockGoods;
  requested: StockGoods;
  stage: "deposit" | "accept";
  tradeId: string;
}

/** The account's Market mailbox and the operations a closed window must remember. */
export interface MarketSnapshot {
  /** The player's open offers, newest first; their offered goods are in escrow. */
  mine: MarketTrade[];
  /** Public open offers from other players (and recipient-only offers addressed to this account). */
  others: MarketTrade[];
  pendingBuy: MarketPendingBuy | null;
  pendingClaim: MarketPendingClaim | null;
  pendingOffer: MarketPendingOffer | null;
  /** The authoritative free wallet: goods waiting for an explicit claim to the home island. */
  wallet: StockWallet;
}

/** One action's honest outcome: the message says what committed, and the latest Market state when it was read. */
export interface MarketResult {
  message: string;
  ok: boolean;
  pendingBuy: MarketPendingBuy | null;
  pendingClaim: MarketPendingClaim | null;
  pendingOffer: MarketPendingOffer | null;
  snapshot?: MarketSnapshot;
}

/** The player-facing Market operations; the settlement session binds the stock-move callbacks behind them. */
export interface MarketControls {
  accept(trade: MarketTrade): Promise<MarketResult>;
  cancel(tradeId: string): Promise<MarketResult>;
  claim(goods: StockGoods): Promise<MarketResult>;
  discardPendingBuy(): void;
  discardPendingClaim(): void;
  discardPendingOffer(): void;
  load(): Promise<MarketSnapshot>;
  offer(draft: MarketOfferDraft): Promise<MarketResult>;
  retryBuy(): Promise<MarketResult>;
  retryClaim(): Promise<MarketResult>;
  retryOffer(): Promise<MarketResult>;
}
