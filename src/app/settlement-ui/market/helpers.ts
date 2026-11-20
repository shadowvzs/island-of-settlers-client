import type { I18n } from "@lingui/core";
import { TRADE_MAX_LOT_AMOUNT } from "@shared/catalog/balance";

import { translateMessage } from "../../../shared/i18n/translate";
import { wareDisplayName } from "../../../shared/settlement/ware-names";
import {
  isMarketWare, MARKET_OFFER_TTL_SECONDS, MARKET_WARES, marketGoods, type MarketOfferDraft,
  type MarketPendingBuy, type MarketPendingClaim, type MarketPendingOffer, type MarketTrade
} from "../../../shared/trade/market";
import type { StockGoods } from "../../../shared/trade/stock-move";
import { formatWareCount, formatWholeNumber } from "../helpers";
import { SETTLEMENT_MESSAGES as M } from "../messages";

const TTL_LABELS = {
  3600: M.market.ttlHour,
  21600: M.market.ttlSixHours,
  43200: M.market.ttlTwelveHours
} as const;

export interface MarketWareRow {
  count: number;
  /** Units acquired from accepted trades; the rest is deposited or otherwise sourced. */
  received: number;
  label: string;
  name: string;
  ware: string;
}

export interface MarketLot {
  amount: number;
  text: string;
  ware: string;
}

export interface MarketOfferRow {
  cancelLabel: string;
  expiresText: string;
  give: MarketLot[];
  giveText: string;
  id: string;
  need: MarketLot[];
  needText: string;
}

/** Another player's offer from the buyer's side: what arrives, what must leave the wallet or home storage. */
export interface MarketBuyRow {
  action: "accept" | "deposit";
  actionLabel: string;
  buttonLabel: string;
  expiresText: string;
  get: MarketLot[];
  getText: string;
  give: MarketLot[];
  giveText: string;
  id: string;
  problem: string;
}

export interface OfferFormValues {
  offeredAmount: number;
  offeredWare: string;
  requestedAmount: number;
  requestedWare: string;
  ttlSeconds: number;
}

export interface OfferFormView extends OfferFormValues {
  amountLimit: number;
  choices: readonly { label: string; value: string }[];
  offeredName: string;
  problem: string;
  /** Most units one offer may request: the trade office's lot cap. */
  requestedLimit: number;
  requestedName: string;
  ttlChoices: readonly { label: string; value: number }[];
}

/** The requested amount stays within the trade office's lot cap (owner 2026-11-11), like its "I want" side. */
export const clampRequestedAmount = (amount: number) => Math.min(amount, TRADE_MAX_LOT_AMOUNT);

const countOf = (goods: Readonly<Record<string, number>> | undefined, ware: string) => {
  const count = goods?.[ware];
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count <= 0) return 0;
  return count;
};

const wareRow = (ware: string, count: number, received = 0): MarketWareRow => {
  const name = wareDisplayName(ware);
  return { count, received: Math.min(count, received), label: `${name}: ${formatWholeNumber(count)}`,
    name, ware };
};

/** All 12 Market wares in allowlist order, including zero counts, for the home-storage section. */
export const getHomeRows = (resources: Readonly<Record<string, number>> | undefined): MarketWareRow[] =>
  MARKET_WARES.map(ware => wareRow(ware, countOf(resources, ware)));

/** The wallet's claimable Market goods; other wares and zero balances are not shown. */
export const getWalletRows = (
  inventory: Readonly<Record<string, number>> | undefined,
  received?: Readonly<Record<string, number>>
): MarketWareRow[] =>
  MARKET_WARES.flatMap(ware => {
    const count = countOf(inventory, ware);
    return count ? [wareRow(ware, count, countOf(received, ware))] : [];
  });

export const walletGoods = (rows: readonly MarketWareRow[]): StockGoods =>
  Object.fromEntries(rows.filter(row => row.count > 0).map(row => [row.ware, row.count]));

export const totalRows = (rows: readonly MarketWareRow[]) => rows.reduce((sum, row) => sum + row.count, 0);

const formatExpiry = (expiresAt: string, i18n?: I18n) => {
  const time = Date.parse(expiresAt);
  if (!Number.isFinite(time)) return translateMessage(i18n, M.market.expiryUnknown);
  return translateMessage(i18n, M.market.expiry, {
    time: new Date(time).toISOString().slice(11, 16)
  });
};

/** A due/clock-skewed offer waits at least a second so the refresh timer cannot spin. */
export const MARKET_EXPIRY_MIN_DELAY_MS = 1_000;
/** The longest single Market wait; the timer recomputes after each refresh instead of polling. */
export const MARKET_EXPIRY_MAX_DELAY_MS = 30 * 60_000;

/**
 * The delay until the next open offer expires, or null when the tab is hidden or nothing has a finite expiry.
 * The result is clamped so passed/invalid clocks cannot schedule a hot loop and far expiries stay bounded.
 */
export const getMarketExpiryDelay = (
  offers: readonly Pick<MarketTrade, "expired" | "expires_at" | "status">[],
  now: number,
  hidden = false
): number | null => {
  if (hidden || !Number.isFinite(now)) return null;
  let earliest = Number.POSITIVE_INFINITY;
  for (const offer of offers) {
    if (offer.expired === true || offer.status !== "open") continue;
    const expiresAt = Date.parse(offer.expires_at);
    if (Number.isFinite(expiresAt)) earliest = Math.min(earliest, expiresAt);
  }
  if (!Number.isFinite(earliest)) return null;
  return Math.min(MARKET_EXPIRY_MAX_DELAY_MS,
    Math.max(MARKET_EXPIRY_MIN_DELAY_MS, earliest - now));
};

export const getGoodsLots = (goods: Readonly<Record<string, number>>): MarketLot[] =>
  MARKET_WARES.flatMap(ware => {
    const count = countOf(goods, ware);
    return count ? [{ amount: count, text: formatWareCount(count, ware), ware }] : [];
  });

const lotsText = (lots: readonly MarketLot[]) => lots.map(lot => lot.text).join(", ");

/** The player's open offers with both sides already formatted and every non-allowlisted ware removed. */
export const getOfferRows = (trades: readonly MarketTrade[], i18n?: I18n): MarketOfferRow[] =>
  trades.map(trade => {
    const give = getGoodsLots(trade.offered), need = getGoodsLots(trade.requested);
    const giveText = lotsText(give) || translateMessage(i18n, M.market.noWares);
    const needText = lotsText(need) || translateMessage(i18n, M.market.noWares);
    return {
      cancelLabel: translateMessage(i18n, M.market.cancelOffer, { give: giveText, need: needText }),
      expiresText: formatExpiry(trade.expires_at, i18n),
      give,
      giveText,
      id: trade.id,
      need,
      needText
    };
  });

/** Requested lots the player cannot cover from the free Market wallet plus free home storage. */
const getMissingLots = (
  requested: Readonly<Record<string, number>>, wallet: Readonly<Record<string, number>>,
  home: Readonly<Record<string, number>>
): MarketLot[] => MARKET_WARES.flatMap(ware => {
  const needed = countOf(requested, ware);
  if (!needed) return [];
  const missing = needed - countOf(wallet, ware) - countOf(home, ware);
  return missing > 0 ? [{ amount: missing, text: formatWareCount(missing, ware), ware }] : [];
});

/** Why another player's offer cannot be bought, or "" when the wallet and home storage cover it. */
export const getBuyProblem = (
  trade: MarketTrade, wallet: Readonly<Record<string, number>>, home: Readonly<Record<string, number>>,
  i18n?: I18n
): string => {
  const missing = getMissingLots(trade.requested, wallet, home);
  if (!missing.length) return "";
  return translateMessage(i18n, M.market.buyMissing, {
    wares: missing.map(lot => lot.text).join(", ")
  });
};

/** Other players' offers from the buyer's side: "You get" their goods for "You give" the requested goods. */
export const getBuyRows = (
  trades: readonly MarketTrade[], wallet: Readonly<Record<string, number>>,
  home: Readonly<Record<string, number>>, i18n?: I18n
): MarketBuyRow[] => trades.map(trade => {
  const get = getGoodsLots(trade.offered), give = getGoodsLots(trade.requested);
  const getText = lotsText(get) || translateMessage(i18n, M.market.noWares);
  const giveText = lotsText(give) || translateMessage(i18n, M.market.noWares);
  const deposit = give.some(lot => countOf(wallet, lot.ware) < lot.amount);
  return {
    action: deposit ? "deposit" : "accept",
    actionLabel: translateMessage(i18n, deposit ? M.market.depositAndAccept : M.market.acceptOffer),
    buttonLabel: translateMessage(i18n,
      deposit ? M.market.depositAndAcceptLabel : M.market.acceptOfferLabel, { get: getText, give: giveText }),
    expiresText: formatExpiry(trade.expires_at, i18n),
    get,
    getText,
    give,
    giveText,
    id: trade.id,
    problem: getBuyProblem(trade, wallet, home, i18n)
  };
});

const getTtlChoices = (i18n?: I18n) => MARKET_OFFER_TTL_SECONDS.map(seconds => ({
  label: TTL_LABELS[seconds as keyof typeof TTL_LABELS]
    ? translateMessage(i18n, TTL_LABELS[seconds as keyof typeof TTL_LABELS])
    : translateMessage(i18n, M.market.ttlSeconds, { seconds }),
  value: seconds
}));

const getWareChoices = () => MARKET_WARES.map(ware => ({
  label: wareDisplayName(ware),
  value: ware
}));

export const defaultOfferForm = (home: Readonly<Record<string, number>>): OfferFormValues => {
  const offeredWare = MARKET_WARES.find(ware => countOf(home, ware) > 0) ?? MARKET_WARES[0]!;
  const requestedWare = MARKET_WARES.find(ware => ware !== offeredWare) ?? MARKET_WARES[1]!;
  return { offeredAmount: 1, offeredWare, requestedAmount: 1, requestedWare, ttlSeconds: 43200 };
};

/** The draft's two sides as protocol goods; invalid values are kept as typed so validation can explain them. */
export const getOfferDraft = ({ offeredAmount, offeredWare, requestedAmount, requestedWare, ttlSeconds }:
  OfferFormValues): MarketOfferDraft => ({
  offered: marketGoods({ [offeredWare]: offeredAmount }),
  requested: marketGoods({ [requestedWare]: requestedAmount }),
  ttlSeconds
});

/** Why the draft cannot be offered, or "" when it can; the offered side is bounded by home storage. */
export const getOfferProblem = (
  form: OfferFormValues, home: Readonly<Record<string, number>>, i18n?: I18n
): string => {
  if (!isMarketWare(form.offeredWare) || !isMarketWare(form.requestedWare))
    return translateMessage(i18n, M.market.chooseWares);
  if (!Number.isSafeInteger(form.offeredAmount) || form.offeredAmount < 1)
    return translateMessage(i18n, M.market.positiveOffer);
  if (!Number.isSafeInteger(form.requestedAmount) || form.requestedAmount < 1)
    return translateMessage(i18n, M.market.positiveRequest);
  const available = countOf(home, form.offeredWare);
  if (form.offeredAmount > available)
    return translateMessage(i18n, M.market.onlyFree, {
      wares: formatWareCount(available, form.offeredWare)
    });
  if (!(MARKET_OFFER_TTL_SECONDS as readonly number[]).includes(form.ttlSeconds))
    return translateMessage(i18n, M.market.lifetimeRequired);
  return "";
};

export const getOfferFormView = (
  form: OfferFormValues, home: Readonly<Record<string, number>>, i18n?: I18n
): OfferFormView => ({
  ...form,
  amountLimit: countOf(home, form.offeredWare),
  choices: getWareChoices(),
  offeredName: wareDisplayName(form.offeredWare),
  problem: getOfferProblem(form, home, i18n),
  requestedLimit: TRADE_MAX_LOT_AMOUNT,
  requestedName: wareDisplayName(form.requestedWare),
  ttlChoices: getTtlChoices(i18n)
});

export const getPendingOfferTitle = (pending: MarketPendingOffer, i18n?: I18n) => translateMessage(i18n,
  pending.stage === "deposit" ? M.market.pendingDeposit : M.market.pendingOffer);

export const getPendingClaimTitle = (i18n?: I18n) => translateMessage(i18n, M.market.pendingClaim);

export const getPendingOfferText = (pending: MarketPendingOffer, i18n?: I18n) =>
  translateMessage(i18n, M.market.pendingOfferText, { message: pending.message });

export const getPendingClaimText = (pending: MarketPendingClaim, i18n?: I18n) =>
  translateMessage(i18n, M.market.pendingClaimText, { message: pending.message });

export const getPendingBuyTitle = (pending: MarketPendingBuy, i18n?: I18n) => translateMessage(i18n,
  pending.stage === "deposit" ? M.market.pendingBuyDeposit : M.market.pendingBuyAccept);

export const getPendingBuyText = (pending: MarketPendingBuy, i18n?: I18n) => translateMessage(i18n,
  pending.stage === "deposit" ? M.market.pendingBuyDepositText : M.market.pendingBuyAcceptText,
  { message: pending.message });

/** A per-ware claim may send whole amounts from 1 to the available balance; unset/invalid means the full row. */
export const clampClaimAmount = (available: number, amount: number): number => {
  if (!Number.isSafeInteger(available) || available < 1) return 0;
  if (!Number.isFinite(amount)) return available;
  return Math.min(available, Math.max(1, Math.trunc(amount)));
};

/** The claim button's accessible name for one wallet row and the amount it currently sends. */
export const getClaimLabel = (row: MarketWareRow, i18n?: I18n, amount = row.count) =>
  translateMessage(i18n, M.market.claimToHome, {
    wares: formatWareCount(clampClaimAmount(row.count, amount), row.ware)
  });
