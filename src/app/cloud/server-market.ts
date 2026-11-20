import { isPlainObject } from "../../../../island-of-settlers-shared/src/validation/index";
import {
  goodsSignature, isMarketGoods, isMarketWare, marketGoods, type MarketOfferDraft,
  type MarketPendingBuy, type MarketPendingClaim, type MarketPendingOffer, type MarketResult,
  type MarketSnapshot, type MarketTrade
} from "../../shared/trade/market";
import type { StockGoods, StockWallet } from "../../shared/trade/stock-move";
import { errorMessage } from "../helpers";
import { PREFERENCE_FAMILIES } from "../preferences/keys";
import type { StockMoveApply } from "../save-store/remote-save-store";
import type { EconomyClient, WalletView } from "./economy-client";
import type { StockMoveClient, StockMoveOutcome } from "./stock-move";

/** The persisted-operation surface the Market needs; `sessionStorage` keeps retries alive across a reload. */
export type MarketOperationStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

interface ServerMarketOptions {
  /** The authenticated account: distinguishes the player's own offers from the returned history. */
  accountId: string;
  client: Pick<EconomyClient, "acceptTrade" | "cancelTrade" | "createTrade" | "listTrades" | "wallet">;
  newKey?: () => string;
  /** Clock used to hide an expired offer before the server's 30-second reconcile tick (tests pin it). */
  now?: () => number;
  /** The typed stock bridge; every deposit/withdrawal still adopts the returned save revision. */
  stock: Pick<StockMoveClient, "move">;
  /** Distinguishes slot-bound stock operations when the tab changes slots (offers themselves are account-wide). */
  scope?: string;
  /** Per-tab session storage; a missing or throwing storage falls back to memory for this page. */
  storage?: MarketOperationStorage;
}

/** The protocol calls that still need the settlement's local storage callback. */
export interface ServerMarket {
  accept(trade: MarketTrade, apply?: StockMoveApply): Promise<MarketResult>;
  cancel(tradeId: string): Promise<MarketResult>;
  claim(goods: StockGoods, apply?: StockMoveApply): Promise<MarketResult>;
  discardPendingBuy(): void;
  discardPendingClaim(): void;
  discardPendingOffer(): void;
  load(): Promise<MarketSnapshot>;
  offer(draft: MarketOfferDraft, apply?: StockMoveApply): Promise<MarketResult>;
  retryBuy(apply?: StockMoveApply): Promise<MarketResult>;
  retryClaim(apply?: StockMoveApply): Promise<MarketResult>;
  retryOffer(apply?: StockMoveApply): Promise<MarketResult>;
}

const PENDING_OFFER = "pending-offer";
const PENDING_CLAIM = "pending-claim";
const PENDING_BUY = "pending-buy";
const MAX_OFFER_TTL_SECONDS = 12 * 60 * 60;
/** The API's largest page; older pages are followed until the cursor ends or the safety cap. */
const MARKET_PAGE_SIZE = 100;
/** A broken cursor must not keep the Market loading forever; 10 pages cover 1000 records. */
const MARKET_MAX_PAGES = 10;

/** Reads the Market's cursor pages in order, deduplicating ids and stopping on a missing/repeated cursor. */
const listTradePages = async (
  client: Pick<EconomyClient, "listTrades">
): Promise<MarketTrade[]> => {
  const trades: MarketTrade[] = [];
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let after: string | undefined;
  for (let pageNumber = 0; pageNumber < MARKET_MAX_PAGES; pageNumber++) {
    const page = await client.listTrades({ ...(after ? { after } : {}), limit: MARKET_PAGE_SIZE });
    for (const trade of page.trades ?? []) {
      if (ids.has(trade.id)) continue;
      ids.add(trade.id);
      trades.push(trade);
    }
    const next = page.nextCursor;
    if (!next || typeof next !== "string" || cursors.has(next)) return trades;
    cursors.add(next);
    after = next;
  }
  return trades;
};

/** Parsed goods of a persisted operation: every ware must be allowed and positive. */
const storedGoods = (value: unknown): StockGoods | null => {
  if (!isPlainObject(value) || !Object.keys(value).length) return null;
  const valid = Object.entries(value).every(([ware, count]) =>
    isMarketWare(ware) && Number.isSafeInteger(count) && (count as number) > 0);
  return valid ? value as StockGoods : null;
};

const normalizeWallet = (wallet: WalletView): StockWallet => ({
  blessingScrolls: wallet.blessingScrolls ?? 0,
  delivery: wallet.delivery ?? "withdrawable",
  gems: wallet.gems,
  inventory: marketGoods(wallet.inventory),
  received: marketGoods(wallet.received),
  revision: wallet.revision ?? 0
});

const sanitizeTrade = (trade: MarketTrade): MarketTrade => ({
  ...trade,
  offered: marketGoods(trade.offered),
  requested: marketGoods(trade.requested)
});

const stockFailure = (outcome: Extract<StockMoveOutcome, { ok: false }>, direction: "deposit" | "withdraw") => {
  if (outcome.reason === "lease-lost")
    return "Another device took the session. Take it back, then retry.";
  if (outcome.reason === "no-account")
    return "Sign in with a cloud save to use the Player Market.";
  if (outcome.reason === "not-loaded")
    return "Load the cloud save before moving island goods.";
  if (outcome.reason === "stale")
    return direction === "deposit"
      ? "The goods reached the server, but this save changed first. Reload the save; the goods are in your " +
        "Market wallet."
      : "The claim reached the server, but this save changed first. Reload the save to see the goods in your " +
        "home storage.";
  return outcome.message;
};

const pendingOfferOf = (value: unknown): MarketPendingOffer | null => {
  if (!isPlainObject(value)) return null;
  const offered = storedGoods(value.offered), requested = storedGoods(value.requested);
  if (!offered || !requested || (value.stage !== "deposit" && value.stage !== "trade") ||
    typeof value.depositKey !== "string" || typeof value.tradeKey !== "string" ||
    typeof value.id !== "string" || typeof value.message !== "string" ||
    typeof value.discardable !== "boolean" || typeof value.ttlSeconds !== "number")
    return null;
  return { discardable: value.discardable, depositKey: value.depositKey, id: value.id,
    message: value.message, offered, requested, stage: value.stage, tradeKey: value.tradeKey,
    ttlSeconds: value.ttlSeconds };
};

const pendingClaimOf = (value: unknown): MarketPendingClaim | null => {
  if (!isPlainObject(value)) return null;
  const goods = storedGoods(value.goods);
  if (!goods || typeof value.id !== "string" || typeof value.key !== "string" ||
    typeof value.message !== "string") return null;
  return { goods, id: value.id, key: value.key, message: value.message };
};

const pendingBuyOf = (value: unknown): MarketPendingBuy | null => {
  if (!isPlainObject(value)) return null;
  const offered = storedGoods(value.offered), requested = storedGoods(value.requested);
  if (!offered || !requested || (value.stage !== "deposit" && value.stage !== "accept") ||
    typeof value.acceptKey !== "string" || typeof value.depositKey !== "string" ||
    typeof value.id !== "string" || typeof value.message !== "string" ||
    typeof value.tradeId !== "string" || typeof value.discardable !== "boolean")
    return null;
  return { acceptKey: value.acceptKey, depositKey: value.depositKey, discardable: value.discardable,
    id: value.id, message: value.message, offered, requested, stage: value.stage, tradeId: value.tradeId };
};

/** How much of `requested` is still missing from the free wallet; empty means the wallet covers the purchase. */
const shortfallOf = (
  requested: Readonly<Record<string, number>>, inventory: Readonly<Record<string, number>>
): StockGoods => {
  const shortfall: StockGoods = {};
  for (const [ware, count] of Object.entries(requested)) {
    const available = inventory[ware];
    const free = typeof available === "number" && Number.isSafeInteger(available) && available > 0 ? available : 0;
    if (free < count) shortfall[ware] = count - free;
  }
  return shortfall;
};

/** The purchase's persisted keys and last confirmed stage; the requested goods leave home only when short. */
const newPendingBuy = (trade: MarketTrade, inventory: Readonly<Record<string, number>>,
  keys: { acceptKey: string; depositKey: string; id: string }): MarketPendingBuy => {
  const needsDeposit = Object.keys(shortfallOf(trade.requested, inventory)).length > 0;
  return {
    acceptKey: keys.acceptKey,
    depositKey: keys.depositKey,
    discardable: !needsDeposit,
    id: keys.id,
    message: needsDeposit ? "Depositing the requested goods…" : "Accepting the offer…",
    offered: marketGoods(trade.offered),
    requested: marketGoods(trade.requested),
    stage: needsDeposit ? "deposit" : "accept",
    tradeId: trade.id
  };
};

/** The persisted-operation namespace: session storage with a per-page memory fallback for blocked storage. */
const createOperationStorage = (account: string, scope: string | undefined,
  storage: MarketOperationStorage | undefined) => {
  const memory = new Map<string, string>();
  const scopePrefix = scope ? `${scope.toLowerCase()}.` : "";
  const { prefix } = PREFERENCE_FAMILIES.marketOperation;
  const storageKey = (suffix: string) => `${prefix}${account}.${scopePrefix}${suffix}`;
  const readRaw = (suffix: string) => {
    try {
      const value = storage?.getItem(storageKey(suffix));
      if (value !== null && value !== undefined) return value;
    } catch {
      // A blocked storage still has this page's memory fallback.
    }
    return memory.get(suffix) ?? null;
  };
  const writeRaw = (suffix: string, value: string) => {
    memory.set(suffix, value);
    try { storage?.setItem(storageKey(suffix), value); } catch { /* memory remains authoritative */ }
  };
  const removeRaw = (suffix: string) => {
    memory.delete(suffix);
    try { storage?.removeItem(storageKey(suffix)); } catch { /* memory is already cleared */ }
  };
  const readJson = (suffix: string) => {
    const raw = readRaw(suffix);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      removeRaw(suffix);
      return null;
    }
  };
  return { readJson, readRaw, removeRaw, writeRaw };
};

/**
 * The signed-in player's server Market (docs/server/trade-island-protocol.md): a combined offer/claim flow
 * over the existing deposit, create, cancel and withdraw calls. The two stock steps of an offer are not one
 * transaction, so each operation's idempotency keys and last confirmed stage are kept until it succeeds:
 * a retry after a successful deposit never deposits the same goods twice.
 */
export const createServerMarket = ({ accountId, client, newKey = () => crypto.randomUUID(), now = Date.now,
  scope, stock, storage }: ServerMarketOptions): ServerMarket => {
  const account = accountId.toLowerCase();
  const { readJson, readRaw, removeRaw, writeRaw } = createOperationStorage(account, scope, storage);
  const readPending = <T>(suffix: string, parse: (value: unknown) => T | null) => {
    const parsed = parse(readJson(suffix));
    if (!parsed) removeRaw(suffix);
    return parsed;
  };
  const readPendingOffer = () => readPending(PENDING_OFFER, pendingOfferOf);
  const readPendingClaim = () => readPending(PENDING_CLAIM, pendingClaimOf);
  const readPendingBuy = () => readPending(PENDING_BUY, pendingBuyOf);
  const savePendingOffer = (pending: MarketPendingOffer) => writeRaw(PENDING_OFFER, JSON.stringify(pending));
  const savePendingClaim = (pending: MarketPendingClaim) => writeRaw(PENDING_CLAIM, JSON.stringify(pending));
  const savePendingBuy = (pending: MarketPendingBuy) => writeRaw(PENDING_BUY, JSON.stringify(pending));
  const createKey = (kind: string) => `market-${kind}-${newKey()}`;
  const operationKey = (kind: "deposit" | "trade" | "cancel" | "claim" | "accept") => createKey(kind);

  const result = (ok: boolean, message: string, snapshot?: MarketSnapshot): MarketResult => ({
    message,
    ok,
    pendingBuy: readPendingBuy(),
    pendingClaim: readPendingClaim(),
    pendingOffer: readPendingOffer(),
    ...(snapshot ? { snapshot } : {})
  });
  const loadOrUndefined = async () => {
    try {
      return await load();
    } catch {
      return undefined;
    }
  };

  const load = async (): Promise<MarketSnapshot> => {
    const [wallet, trades] = await Promise.all([client.wallet(), listTradePages(client)]);
    const clock = now();
    const open = trades.filter(trade => trade.status === "open" &&
      trade.expired !== true && Date.parse(trade.expires_at) > clock);
    const mine = open.filter(trade => trade.seller_id.toLowerCase() === account).map(sanitizeTrade);
    const ownIds = new Set(mine.map(trade => trade.id));
    const others = open
      .filter(trade => trade.seller_id.toLowerCase() !== account && !ownIds.has(trade.id) &&
        (trade.recipient_id === null || trade.recipient_id.toLowerCase() === account))
      .map(sanitizeTrade);
    return {
      mine,
      others,
      pendingBuy: readPendingBuy(),
      pendingClaim: readPendingClaim(),
      pendingOffer: readPendingOffer(),
      wallet: normalizeWallet(wallet)
    };
  };

  const executeOffer = async (initial: MarketPendingOffer, apply?: StockMoveApply): Promise<MarketResult> => {
    let pending = initial;
    if (pending.stage === "deposit") {
      let outcome: StockMoveOutcome;
      try {
        outcome = await stock.move({ direction: "deposit", goods: pending.offered,
          idempotencyKey: pending.depositKey }, apply);
      } catch (error) {
        const message = `The deposit was not confirmed (${errorMessage(error, "no answer")}). ` +
          "Retry with the same request; the Market will not deposit the goods twice.";
        pending = { ...pending, message };
        savePendingOffer(pending);
        return result(false, message);
      }
      if (!outcome.ok) {
        const stage = outcome.reason === "stale" ? "trade" : pending.stage;
        const message = stockFailure(outcome, "deposit") +
          (stage === "trade" ? " You can retry creating the offer from the wallet." : "");
        pending = { ...pending, discardable: true, message, stage };
        savePendingOffer(pending);
        return result(false, message, await loadOrUndefined());
      }
      pending = { ...pending, discardable: true, message: "Goods deposited. Creating the offer…",
        stage: "trade" };
      savePendingOffer(pending);
    }
    let created: Awaited<ReturnType<MarketServerClient["createTrade"]>>;
    try {
      created = await client.createTrade({ idempotencyKey: pending.tradeKey, offered: pending.offered,
        requested: pending.requested, ttlSeconds: pending.ttlSeconds });
    } catch (error) {
      const message = `The offer was not confirmed (${errorMessage(error, "no answer")}). ` +
        "Retry the same offer safely; the Market cannot escrow its goods twice.";
      pending = { ...pending, message };
      savePendingOffer(pending);
      return result(false, message, await loadOrUndefined());
    }
    if (!created.ok) {
      const message = `Offer not created: ${created.reason}. Its goods stay in your Market wallet; ` +
        "retry the offer or discard and claim them to home.";
      pending = { ...pending, message };
      savePendingOffer(pending);
      return result(false, message, await loadOrUndefined());
    }
    removeRaw(PENDING_OFFER);
    if (created.trade.expired) {
      const message = "The offer was created but has already expired; refresh the Market to see its goods " +
        "back in your wallet.";
      return result(false, message, await loadOrUndefined());
    }
    return result(true, "Offer created. The offered goods are held in escrow until the offer settles.",
      await loadOrUndefined());
  };

  const executeBuy = async (initial: MarketPendingBuy, apply?: StockMoveApply): Promise<MarketResult> => {
    let pending = initial;
    if (pending.stage === "deposit") {
      let inventory: StockGoods;
      try {
        inventory = normalizeWallet(await client.wallet()).inventory;
      } catch (error) {
        const message = `The Market wallet was not confirmed (${errorMessage(error, "no answer")}). ` +
          "Retry with the same request; the Market will not deposit the goods twice.";
        pending = { ...pending, message };
        savePendingBuy(pending);
        return result(false, message);
      }
      const shortfall = shortfallOf(pending.requested, inventory);
      if (Object.keys(shortfall).length) {
        let outcome: StockMoveOutcome;
        try {
          outcome = await stock.move({ direction: "deposit", goods: shortfall,
            idempotencyKey: pending.depositKey }, apply);
        } catch (error) {
          const message = `The purchase deposit was not confirmed (${errorMessage(error, "no answer")}). ` +
            "Retry with the same request; the Market will not deposit the goods twice.";
          pending = { ...pending, message };
          savePendingBuy(pending);
          return result(false, message);
        }
        if (!outcome.ok) {
          const stage = outcome.reason === "stale" ? "accept" : pending.stage;
          const message = stockFailure(outcome, "deposit") +
            (stage === "accept" ? " You can retry accepting the offer from the wallet." : "");
          pending = { ...pending, discardable: true, message, stage };
          savePendingBuy(pending);
          return result(false, message, await loadOrUndefined());
        }
      }
      pending = { ...pending, discardable: true, message: "Requested goods deposited. Accepting the offer…",
        stage: "accept" };
      savePendingBuy(pending);
    }
    let accepted: Awaited<ReturnType<MarketServerClient["acceptTrade"]>>;
    try {
      accepted = await client.acceptTrade(pending.tradeId, pending.acceptKey);
    } catch (error) {
      const message = `The acceptance was not confirmed (${errorMessage(error, "no answer")}). ` +
        "Retry with the same request; the Market cannot exchange the same offer twice.";
      pending = { ...pending, discardable: true, message, stage: "accept" };
      savePendingBuy(pending);
      return result(false, message, await loadOrUndefined());
    }
    if (!accepted.ok) {
      const message = `Offer not accepted: ${accepted.reason}. ` +
        "The requested goods stay in your Market wallet; retry the acceptance or discard it.";
      pending = { ...pending, discardable: true, message, stage: "accept" };
      savePendingBuy(pending);
      return result(false, message, await loadOrUndefined());
    }
    removeRaw(PENDING_BUY);
    return result(true, "Offer accepted. The offered goods are now in your Market wallet.",
      await loadOrUndefined());
  };

  const executeClaim = async (initial: MarketPendingClaim, apply?: StockMoveApply): Promise<MarketResult> => {
    let pending = initial;
    let outcome: StockMoveOutcome;
    try {
      outcome = await stock.move({ direction: "withdraw", goods: pending.goods,
        idempotencyKey: pending.key }, apply);
    } catch (error) {
      const message = `The claim was not confirmed (${errorMessage(error, "no answer")}). ` +
        "Retry the claim; the same request cannot withdraw the goods twice.";
      pending = { ...pending, message };
      savePendingClaim(pending);
      return result(false, message);
    }
    if (!outcome.ok) {
      if (outcome.reason === "stale") {
        removeRaw(PENDING_CLAIM);
        return result(false, stockFailure(outcome, "withdraw"), await loadOrUndefined());
      }
      const message = stockFailure(outcome, "withdraw");
      pending = { ...pending, message };
      savePendingClaim(pending);
      return result(false, message);
    }
    removeRaw(PENDING_CLAIM);
    return result(true, "Goods claimed to your home storage.", await loadOrUndefined());
  };

  const accept = async (trade: MarketTrade, apply?: StockMoveApply): Promise<MarketResult> => {
    const existing = readPendingBuy();
    if (existing) {
      if (existing.tradeId !== trade.id)
        return result(false, "Finish the unfinished purchase first.");
      return executeBuy(existing, apply);
    }
    if (trade.seller_id.toLowerCase() === account)
      return result(false, "You cannot accept your own offer.");
    if (trade.status !== "open" || trade.expired === true || !(Date.parse(trade.expires_at) > now()))
      return result(false, "This offer is no longer open.");
    if (!isMarketGoods(trade.offered) || !isMarketGoods(trade.requested))
      return result(false, "Offers can use only the 12 Market wares, in whole positive amounts.");
    let walletView: WalletView;
    try {
      walletView = await client.wallet();
    } catch (error) {
      return result(false, `The Market wallet could not be read (${errorMessage(error, "no answer")}). ` +
        "Retry the purchase.");
    }
    const pending = newPendingBuy(trade, normalizeWallet(walletView).inventory, {
      acceptKey: operationKey("accept"), depositKey: operationKey("deposit"), id: newKey()
    });
    savePendingBuy(pending);
    return executeBuy(pending, apply);
  };

  const retryBuy = async (apply?: StockMoveApply): Promise<MarketResult> => {
    const pending = readPendingBuy();
    if (!pending) return result(false, "There is no unfinished purchase to retry.");
    return executeBuy(pending, apply);
  };

  const offer = async (draft: MarketOfferDraft, apply?: StockMoveApply): Promise<MarketResult> => {
    if (readPendingOffer()) return result(false, "Finish the unfinished offer first.");
    if (!isMarketGoods(draft.offered) || !isMarketGoods(draft.requested))
      return result(false, "Offers can use only the 12 Market wares, in whole positive amounts.");
    if (!Number.isSafeInteger(draft.ttlSeconds) || draft.ttlSeconds < 60 ||
      draft.ttlSeconds > MAX_OFFER_TTL_SECONDS)
      return result(false, "Offers must last between 1 minute and 12 hours.");
    const pending: MarketPendingOffer = {
      discardable: false,
      depositKey: operationKey("deposit"),
      id: newKey(),
      message: "Depositing the offered goods…",
      offered: draft.offered,
      requested: draft.requested,
      stage: "deposit",
      tradeKey: operationKey("trade"),
      ttlSeconds: draft.ttlSeconds
    };
    savePendingOffer(pending);
    return executeOffer(pending, apply);
  };

  const retryOffer = async (apply?: StockMoveApply): Promise<MarketResult> => {
    const pending = readPendingOffer();
    if (!pending) return result(false, "There is no unfinished offer to retry.");
    return executeOffer(pending, apply);
  };

  const claim = async (goods: StockGoods, apply?: StockMoveApply): Promise<MarketResult> => {
    if (!isMarketGoods(goods)) return result(false, "Choose a positive amount of the 12 Market wares.");
    const pending = readPendingClaim();
    if (pending) {
      if (goodsSignature(pending.goods) !== goodsSignature(goods))
        return result(false, "An earlier claim is still waiting for confirmation. Retry it first.");
      return executeClaim(pending, apply);
    }
    const next: MarketPendingClaim = { goods, id: newKey(), key: operationKey("claim"),
      message: "Claiming the goods to your home storage…" };
    savePendingClaim(next);
    return executeClaim(next, apply);
  };

  const retryClaim = async (apply?: StockMoveApply): Promise<MarketResult> => {
    const pending = readPendingClaim();
    if (!pending) return result(false, "There is no unfinished claim to retry.");
    return executeClaim(pending, apply);
  };

  const discardPendingBuy = () => {
    removeRaw(PENDING_BUY);
  };
  const discardPendingOffer = () => {
    removeRaw(PENDING_OFFER);
  };
  const discardPendingClaim = () => {
    removeRaw(PENDING_CLAIM);
  };

  const cancel = async (tradeId: string): Promise<MarketResult> => {
    const suffix = `cancel.${tradeId}`;
    const saved = readRaw(suffix);
    const key = saved ?? operationKey("cancel");
    if (!saved) writeRaw(suffix, key);
    let answer: Awaited<ReturnType<MarketServerClient["cancelTrade"]>>;
    try {
      answer = await client.cancelTrade(tradeId, key);
    } catch (error) {
      const message = `The cancellation was not confirmed (${errorMessage(error, "no answer")}). ` +
        "The offer's goods remain in escrow; retry the cancellation.";
      return result(false, message);
    }
    if (!answer.ok) {
      removeRaw(suffix);
      return result(false, `Offer not cancelled: ${answer.reason}. Refresh the Market for its current state.`,
        await loadOrUndefined());
    }
    removeRaw(suffix);
    return result(true, "Offer cancelled. Its escrowed goods returned to your Market wallet.",
      await loadOrUndefined());
  };

  return { accept, cancel, claim, discardPendingBuy, discardPendingClaim, discardPendingOffer, load, offer,
    retryBuy, retryClaim, retryOffer };
};

type MarketServerClient = ServerMarketOptions["client"];
