import { describe, expect, it, vi } from "vitest";

import type { WalletView } from "../src/app/cloud/economy-client";
import { createServerMarket, type MarketOperationStorage } from "../src/app/cloud/server-market";
import type { StockMoveClient, StockMoveOutcome } from "../src/app/cloud/stock-move";
import type { StockMoveApply } from "../src/app/save-store/remote-save-store";
import type { MarketTrade } from "../src/shared/trade/market";
import type { StockGoods, StockMoveResult } from "../src/shared/trade/stock-move";

const ACCOUNT = "account-1";
const SLOT = "5b0e4c1e-8f43-4b52-9a51-2d0f2d1f0a11";
const TRADE = "7e2c1d3a-4b5c-4d6e-8f90-1a2b3c4d5e6f";

const memoryStorage = (): MarketOperationStorage => {
  const values = new Map<string, string>();
  return {
    getItem: key => values.get(key) ?? null,
    removeItem: key => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); }
  };
};

const wallet = (inventory: StockGoods = { logs: 40 }): WalletView =>
  ({ delivery: "withdrawable", gems: 0, inventory, revision: 1 });

const trade = (overrides: Partial<MarketTrade> = {}): MarketTrade => ({
  buyer_id: null,
  expires_at: "2026-10-24T12:00:00.000Z",
  id: TRADE,
  offered: { logs: 40 },
  recipient_id: null,
  requested: { stone: 2 },
  seller_id: ACCOUNT,
  status: "open",
  ...overrides
});

const moveResult = (goods: StockGoods, direction: "deposit" | "withdraw", revision: number): StockMoveOutcome => {
  const storage: StockGoods = direction === "deposit" ? { logs: 60 } : { logs: 60, stone: 2 };
  const result: StockMoveResult = { goods, revision, slotId: SLOT, storage,
    wallet: { blessingScrolls: 0, delivery: "withdrawable", gems: 0,
      inventory: direction === "deposit" ? { logs: 40 } : { stone: 2 }, revision: 2 } };
  return { applied: true, droppedPending: false, ok: true, result, revision };
};

const keyFactory = () => {
  let next = 0;
  return () => `market-test-key-${++next}-00000000`;
};

const createMarket = (options: {
  acceptTrade?: (id: string, key: string) => Promise<{ ok: true; status: "accepted"; tradeId: string } |
    { ok: false; reason: string }>;
  cancelTrade?: (id: string, key: string) => Promise<{ ok: true; status: "cancelled"; tradeId: string } |
    { ok: false; reason: string }>;
  createTrade?: (body: unknown) => Promise<{ ok: true; trade: MarketTrade } | { ok: false; reason: string }>;
  listTrades?: (page?: { after?: string; limit?: number }) =>
    Promise<{ nextCursor: string | null; trades: MarketTrade[] }>;
  stock?: (request: Parameters<StockMoveClient["move"]>[0], apply?: StockMoveApply) => Promise<StockMoveOutcome>;
  storage?: MarketOperationStorage;
  wallet?: () => Promise<WalletView>;
} = {}) => {
  const stock = vi.fn(options.stock ?? (async () => moveResult({ logs: 40 }, "deposit", 13)));
  const createTrade = vi.fn(options.createTrade ?? (async () => ({ ok: true as const, trade: trade() })));
  const acceptTrade = vi.fn(options.acceptTrade ?? (async () => ({ ok: true as const, status: "accepted" as const,
    tradeId: TRADE })));
  const cancelTrade = vi.fn(options.cancelTrade ?? (async () => ({ ok: true as const, status: "cancelled" as const,
    tradeId: TRADE })));
  const listTrades = vi.fn(options.listTrades ?? (async () => ({ nextCursor: null, trades: [trade()] })));
  const walletView = vi.fn(options.wallet ?? (async () => wallet()));
  const storage = options.storage ?? memoryStorage();
  const market = createServerMarket({
    accountId: ACCOUNT,
    client: { acceptTrade, cancelTrade, createTrade, listTrades, wallet: walletView },
    newKey: keyFactory(),
    now: () => Date.UTC(2026, 9, 24, 0, 0, 0),
    stock: { move: stock as StockMoveClient["move"] },
    storage
  });
  return { acceptTrade, cancelTrade, createTrade, listTrades, market, stock, storage, wallet: walletView };
};

const foreignTrade = (overrides: Partial<MarketTrade> = {}): MarketTrade =>
  trade({ seller_id: "another-account", ...overrides });

const offerDraft = { offered: { logs: 40 }, requested: { stone: 2 }, ttlSeconds: 3600 };

describe("server Market combined flow", () => {
  it("deposits the offered goods, creates the offer and adopts one snapshot", async () => {
    const apply = vi.fn();
    const { createTrade, market, stock } = createMarket();
    const result = await market.offer(offerDraft, apply);
    expect(result.ok).toBe(true);
    expect(result.pendingOffer).toBeNull();
    expect(result.snapshot).toMatchObject({ wallet: { inventory: { logs: 40 } } });
    expect(stock).toHaveBeenCalledTimes(1);
    const deposit = stock.mock.calls[0]![0] as { direction: string; goods: StockGoods; idempotencyKey: string };
    expect(deposit).toMatchObject({ direction: "deposit", goods: { logs: 40 } });
    expect(deposit.idempotencyKey).toMatch(/^market-deposit-/);
    expect(createTrade).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: expect.stringMatching(/^market-trade-/), offered: { logs: 40 }, requested: { stone: 2 },
      ttlSeconds: 3600
    }));
  });

  it("keeps a successful deposit in the wallet when offer creation fails and retries only the offer", async () => {
    let attempts = 0;
    const { createTrade, market, stock } = createMarket({
      createTrade: async () => {
        attempts++;
        return attempts === 1 ? { ok: false, reason: "Open trade limit reached" }
          : { ok: true, trade: trade() };
      }
    });
    const failed = await market.offer(offerDraft);
    expect(failed.ok).toBe(false);
    expect(failed.message).toContain("Market wallet");
    expect(failed.pendingOffer).toMatchObject({ stage: "trade" });
    expect(failed.snapshot?.wallet.inventory).toEqual({ logs: 40 });
    const firstKey = (createTrade.mock.calls[0]![0] as { idempotencyKey: string }).idempotencyKey;

    const retried = await market.retryOffer();
    expect(retried.ok).toBe(true);
    expect(stock).toHaveBeenCalledTimes(1);
    expect(createTrade).toHaveBeenCalledTimes(2);
    expect((createTrade.mock.calls[1]![0] as { idempotencyKey: string }).idempotencyKey).toBe(firstKey);
    expect(retried.pendingOffer).toBeNull();
  });

  it("reuses the deposit key after an unconfirmed response instead of depositing twice", async () => {
    let attempts = 0;
    const { createTrade, market, stock } = createMarket({
      stock: async () => {
        attempts++;
        if (attempts === 1) throw new Error("response lost");
        return moveResult({ logs: 40 }, "deposit", 13);
      }
    });
    const failed = await market.offer(offerDraft);
    expect(failed.ok).toBe(false);
    expect(failed.pendingOffer).toMatchObject({ discardable: false, stage: "deposit" });
    expect(createTrade).not.toHaveBeenCalled();
    const firstKey = (stock.mock.calls[0]![0] as { idempotencyKey: string }).idempotencyKey;

    const retried = await market.retryOffer();
    expect(retried.ok).toBe(true);
    expect(stock).toHaveBeenCalledTimes(2);
    expect((stock.mock.calls[1]![0] as { idempotencyKey: string }).idempotencyKey).toBe(firstKey);
    expect(createTrade).toHaveBeenCalledTimes(1);
  });

  it("reports a deposit refusal without creating an offer", async () => {
    const { createTrade, market } = createMarket({
      stock: async () => ({ message: "Not enough stored logs", ok: false, reason: "conflict" })
    });
    const result = await market.offer(offerDraft);
    expect(result).toMatchObject({ ok: false, message: "Not enough stored logs" });
    expect(result.pendingOffer).toMatchObject({ discardable: true, stage: "deposit" });
    expect(createTrade).not.toHaveBeenCalled();
  });

  it("refuses wares outside the 12-wares allowlist before touching the server", async () => {
    const { market, stock } = createMarket();
    const offerResult = await market.offer({ offered: { bread: 4 }, requested: { stone: 2 }, ttlSeconds: 3600 });
    expect(offerResult).toMatchObject({ ok: false });
    expect(offerResult.message).toContain("12 Market wares");
    const claimResult = await market.claim({ bread: 4 });
    expect(claimResult).toMatchObject({ ok: false });
    expect(claimResult.message).toContain("12 Market wares");
    expect(stock).not.toHaveBeenCalled();
  });

  it("claims wallet goods explicitly and reuses the claim key after a lost response", async () => {
    let attempts = 0;
    const apply = vi.fn();
    const { market, stock } = createMarket({
      stock: async (_request, applyMove) => {
        attempts++;
        if (attempts === 1) throw new Error("response lost");
        applyMove?.({ direction: "withdraw", goods: { logs: 40 }, revision: 13, storage: { logs: 60 } });
        return moveResult({ logs: 40 }, "withdraw", 13);
      }
    });
    const failed = await market.claim({ logs: 40 }, apply);
    expect(failed.ok).toBe(false);
    expect(failed.pendingClaim).toMatchObject({ goods: { logs: 40 } });
    const firstKey = (stock.mock.calls[0]![0] as { idempotencyKey: string }).idempotencyKey;

    const retried = await market.retryClaim(apply);
    expect(retried.ok).toBe(true);
    expect(stock).toHaveBeenCalledTimes(2);
    expect((stock.mock.calls[1]![0] as { idempotencyKey: string }).idempotencyKey).toBe(firstKey);
    expect(retried.pendingClaim).toBeNull();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("reuses a cancellation key after an unconfirmed cancel", async () => {
    let attempts = 0;
    const { cancelTrade, market } = createMarket({
      cancelTrade: async () => {
        attempts++;
        if (attempts === 1) throw new Error("response lost");
        return { ok: true, status: "cancelled", tradeId: TRADE };
      }
    });
    expect((await market.cancel(TRADE)).ok).toBe(false);
    const firstKey = cancelTrade.mock.calls[0]![1] as string;
    expect((await market.cancel(TRADE)).ok).toBe(true);
    expect(cancelTrade.mock.calls[1]![1]).toBe(firstKey);
  });
});

describe("server Market purchases", () => {
  it("accepts another player's offer from the wallet without depositing when it is covered", async () => {
    const { acceptTrade, market, stock } = createMarket({
      wallet: async () => wallet({ stone: 2 })
    });
    const result = await market.accept(foreignTrade());
    expect(result.ok).toBe(true);
    expect(result.pendingBuy).toBeNull();
    expect(result.snapshot?.wallet.inventory).toEqual({ stone: 2 });
    expect(stock).not.toHaveBeenCalled();
    expect(acceptTrade).toHaveBeenCalledWith(TRADE, expect.stringMatching(/^market-accept-/));
  });

  it("deposits only the wallet shortfall before accepting", async () => {
    const { acceptTrade, market, stock } = createMarket({
      wallet: async () => wallet({ stone: 2 })
    });
    const result = await market.accept(foreignTrade({ requested: { stone: 5 } }));
    expect(result.ok).toBe(true);
    expect(stock).toHaveBeenCalledTimes(1);
    const deposit = stock.mock.calls[0]![0] as { direction: string; goods: StockGoods; idempotencyKey: string };
    expect(deposit).toMatchObject({ direction: "deposit", goods: { stone: 3 } });
    expect(deposit.idempotencyKey).toMatch(/^market-deposit-/);
    expect(stock.mock.invocationCallOrder[0]).toBeLessThan(acceptTrade.mock.invocationCallOrder[0]!);
    expect(acceptTrade).toHaveBeenCalledWith(TRADE, expect.stringMatching(/^market-accept-/));
  });

  it("keeps the deposit and retries only accept with the same key after an unconfirmed acceptance", async () => {
    let attempts = 0;
    const { acceptTrade, market, stock } = createMarket({
      acceptTrade: async () => {
        attempts++;
        if (attempts === 1) throw new Error("response lost");
        return { ok: true, status: "accepted", tradeId: TRADE };
      },
      wallet: async () => wallet({})
    });
    const failed = await market.accept(foreignTrade());
    expect(failed.ok).toBe(false);
    expect(failed.pendingBuy).toMatchObject({ discardable: true, stage: "accept", tradeId: TRADE });
    expect(stock).toHaveBeenCalledTimes(1);
    expect(acceptTrade).toHaveBeenCalledTimes(1);
    const firstKey = acceptTrade.mock.calls[0]![1] as string;

    const retried = await market.retryBuy();
    expect(retried.ok).toBe(true);
    expect(stock).toHaveBeenCalledTimes(1);
    expect(acceptTrade).toHaveBeenCalledTimes(2);
    expect(acceptTrade.mock.calls[1]![1]).toBe(firstKey);
    expect(retried.pendingBuy).toBeNull();
  });

  it("keeps an unconfirmed deposit non-discardable and retries it with the same key", async () => {
    let attempts = 0;
    const { acceptTrade, market, stock } = createMarket({
      stock: async () => {
        attempts++;
        if (attempts === 1) throw new Error("response lost");
        return moveResult({ stone: 2 }, "deposit", 13);
      },
      wallet: async () => wallet({})
    });
    const failed = await market.accept(foreignTrade());
    expect(failed.ok).toBe(false);
    expect(failed.pendingBuy).toMatchObject({ discardable: false, stage: "deposit" });
    expect(acceptTrade).not.toHaveBeenCalled();
    const firstKey = stock.mock.calls[0]![0].idempotencyKey;

    const retried = await market.retryBuy();
    expect(retried.ok).toBe(true);
    expect(stock).toHaveBeenCalledTimes(2);
    expect(stock.mock.calls[1]![0].idempotencyKey).toBe(firstKey);
    expect(acceptTrade).toHaveBeenCalledTimes(1);
  });

  it("refuses own, closed, expired and non-Market offers before touching the server", async () => {
    const { acceptTrade, market, stock, wallet: walletView } = createMarket();
    const own = await market.accept(trade());
    expect(own).toMatchObject({ ok: false, message: "You cannot accept your own offer." });
    const closed = await market.accept(foreignTrade({ status: "accepted" }));
    expect(closed).toMatchObject({ ok: false, message: "This offer is no longer open." });
    const expired = await market.accept(foreignTrade({ expires_at: "2026-10-23T00:00:00.000Z" }));
    expect(expired).toMatchObject({ ok: false, message: "This offer is no longer open." });
    const nonMarket = await market.accept(foreignTrade({ requested: { bread: 1 } }));
    expect(nonMarket).toMatchObject({ ok: false });
    expect(nonMarket.message).toContain("12 Market wares");
    expect(acceptTrade).not.toHaveBeenCalled();
    expect(stock).not.toHaveBeenCalled();
    expect(walletView).not.toHaveBeenCalled();
  });

  it("keeps an unfinished purchase across a new Market instance", async () => {
    const storage = memoryStorage();
    const { market: first } = createMarket({
      acceptTrade: async () => { throw new Error("response lost"); },
      storage,
      wallet: async () => wallet({})
    });
    expect((await first.accept(foreignTrade())).pendingBuy).toMatchObject({ stage: "accept" });
    const { acceptTrade, market: second, stock } = createMarket({ storage, wallet: async () => wallet({}) });
    const snapshot = await second.load();
    expect(snapshot.pendingBuy).toMatchObject({ stage: "accept", tradeId: TRADE });
    expect((await second.retryBuy()).ok).toBe(true);
    expect(stock).not.toHaveBeenCalled();
    expect(acceptTrade).toHaveBeenCalledTimes(1);
  });
});

describe("server Market snapshot", () => {
  it("shows the player's open offers and other players' open public or addressed offers", async () => {
    const own = trade({ id: "own-open" });
    const accepted = trade({ id: "own-accepted", status: "accepted" });
    const expired = trade({ id: "own-expired", expired: true });
    const pastExpiry = trade({ id: "own-past-expiry", expires_at: "2026-10-23T00:00:00.000Z" });
    const foreign = trade({ id: "foreign", seller_id: "someone-else" });
    const addressed = trade({ id: "addressed", recipient_id: ACCOUNT, seller_id: "someone-else" });
    const elsewhere = trade({ id: "elsewhere", recipient_id: "third-account", seller_id: "someone-else" });
    const { market } = createMarket({
      listTrades: async () => ({ nextCursor: null,
        trades: [foreign, addressed, elsewhere, accepted, expired, pastExpiry, own] }),
      wallet: async () => wallet({ bread: 9, logs: 40 })
    });
    const snapshot = await market.load();
    expect(snapshot.mine.map(entry => entry.id)).toEqual(["own-open"]);
    expect(snapshot.others.map(entry => entry.id)).toEqual(["foreign", "addressed"]);
    expect(snapshot.wallet.inventory).toEqual({ logs: 40 });
    expect(snapshot.pendingBuy).toBeNull();
    expect(snapshot.pendingClaim).toBeNull();
    expect(snapshot.pendingOffer).toBeNull();
  });

  it("keeps pending operations across a new Market instance using the same storage", async () => {
    const storage = memoryStorage();
    const { market: first } = createMarket({
      createTrade: async () => ({ ok: false, reason: "Open trade limit reached" }), storage
    });
    expect((await first.offer(offerDraft)).pendingOffer).toMatchObject({ stage: "trade" });
    const { market: second } = createMarket({ storage });
    const snapshot = await second.load();
    expect(snapshot.pendingOffer).toMatchObject({ stage: "trade" });
  });

  it("refuses a second offer while an unfinished one waits", async () => {
    const { market } = createMarket({
      stock: async () => ({ message: "Taken over", ok: false, reason: "lease-lost" })
    });
    await market.offer(offerDraft);
    const second = await market.offer({ ...offerDraft, offered: { logs: 1 } });
    expect(second.ok).toBe(false);
    expect(second.message).toBe("Finish the unfinished offer first.");
  });
});

describe("server Market pagination", () => {
  it("follows cursors across pages, dedupes ids and stops at the terminal cursor", async () => {
    const own = trade({ id: "own-first" });
    const foreign = foreignTrade({ id: "other-first" });
    const next = foreignTrade({ id: "other-second" });
    const listTrades = vi.fn(async (page?: { after?: string; limit?: number }) =>
      page?.after === "page-2"
        ? { nextCursor: null, trades: [next, own] }
        : { nextCursor: "page-2", trades: [own, foreign] });
    const { market } = createMarket({ listTrades });

    const snapshot = await market.load();

    expect(listTrades).toHaveBeenCalledTimes(2);
    expect(listTrades).toHaveBeenNthCalledWith(1, { limit: 100 });
    expect(listTrades).toHaveBeenNthCalledWith(2, { after: "page-2", limit: 100 });
    expect(snapshot.mine.map(entry => entry.id)).toEqual(["own-first"]);
    expect(snapshot.others.map(entry => entry.id)).toEqual(["other-first", "other-second"]);
  });

  it("stops when the API repeats a cursor", async () => {
    let calls = 0;
    const listTrades = vi.fn(async () => ({
      nextCursor: "same-cursor",
      trades: [foreignTrade({ id: `other-${++calls}` })]
    }));
    const { market } = createMarket({ listTrades });

    const snapshot = await market.load();

    expect(listTrades).toHaveBeenCalledTimes(2);
    expect(snapshot.others.map(entry => entry.id)).toEqual(["other-1", "other-2"]);
  });

  it("caps a cursor chain that never ends", async () => {
    let calls = 0;
    const listTrades = vi.fn(async () => ({
      nextCursor: `cursor-${++calls}`,
      trades: [foreignTrade({ id: `other-${calls}` })]
    }));
    const { market } = createMarket({ listTrades });

    const snapshot = await market.load();

    expect(listTrades).toHaveBeenCalledTimes(10);
    expect(snapshot.others).toHaveLength(10);
  });
});
