import { describe, expect, it, vi } from "vitest";

import { createEconomyClient } from "../src/app/cloud/economy-client";
import { createStockMoveClient, stockMoveFor } from "../src/app/cloud/stock-move";
import type { StockMoveAdoption, StockMoveBody, StockMoveResult } from "../src/shared/trade/stock-move";
import { applyStockStorageMove, type StockStorageBuilding } from "../src/shared/trade/stock-storage";

const API = "https://api.example.test";
const SLOT = "5b0e4c1e-8f43-4b52-9a51-2d0f2d1f0a11";
const LEASE = "9d6b8a51-1f0e-4a3e-9a51-2d0f2d1f0b22";
const TRADE = "7e2c1d3a-4b5c-4d6e-8f90-1a2b3c4d5e6f";

interface Call {
  body: unknown;
  headers: Record<string, string>;
  method: string;
  url: string;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** A mocked fetch answering each request with the next queued response (a thrown Error: offline). */
const mockFetch = (...responses: (Response | Error)[]) => {
  const calls: Call[] = [];
  const request = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ body: typeof init.body === "string" ? JSON.parse(init.body) as unknown : init.body,
      headers: init.headers as Record<string, string>, method: init.method!, url: url.slice(API.length) });
    const next = responses.shift() ?? new Response(null, { status: 500 });
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  const client = createEconomyClient({ apiUrl: API, fetch: request, getAccessToken: async () => "token-1",
    leaseId: () => LEASE });
  return { calls, client };
};

const wallet = { blessingScrolls: 0, delivery: "withdrawable", gems: 0, inventory: { logs: 40 }, revision: 1 };
const depositBody = { goods: { logs: 40 }, idempotencyKey: "deposit-2026-10-22-a", revision: 12, slotId: SLOT };
const depositResult: StockMoveResult = { goods: { logs: 40 }, revision: 13, slotId: SLOT,
  storage: { fish: 5, logs: 60 }, wallet };

describe("economy stock client", () => {
  it("posts typed deposits and withdrawals with the lease, revision and idempotency key", async () => {
    const withdrawal = { goods: { fish: 2 }, idempotencyKey: "withdraw-2026-10-22-a", revision: 13, slotId: SLOT };
    const withdrawalResult: StockMoveResult = { goods: { fish: 2 }, revision: 14, slotId: SLOT,
      storage: { fish: 7, logs: 60 }, wallet: { ...wallet, inventory: { logs: 40 } } };
    const { calls, client } = mockFetch(json(depositResult), json(withdrawalResult));
    expect(await client.depositStock(depositBody)).toEqual({ ok: true, ...depositResult });
    expect(await client.withdrawStock(withdrawal)).toEqual({ ok: true, ...withdrawalResult });
    expect(calls.map(call => `${call.method} ${call.url}`)).toEqual([
      "POST /v1/economy/stock/deposits", "POST /v1/economy/stock/withdrawals"
    ]);
    expect(calls[0]!.body).toEqual(depositBody);
    expect(calls[1]!.body).toEqual(withdrawal);
    expect(calls.every(call => call.headers.Authorization === "Bearer token-1")).toBe(true);
    expect(calls.every(call => call.headers["X-Session-Lease"] === LEASE)).toBe(true);
  });

  it("tells a stale revision from a lost session lease instead of throwing", async () => {
    const { client } = mockFetch(
      json({ code: "SAVE_CONFLICT", message: "Save changed; reload its latest revision" }, 409),
      json({ code: "SESSION_LEASE_LOST", message: "Another device took the session" }, 409));
    expect(await client.depositStock(depositBody)).toEqual({ message: "Save changed; reload its latest revision",
      ok: false, reason: "conflict" });
    expect(await client.withdrawStock(depositBody)).toEqual({ message: "Another device took the session",
      ok: false, reason: "lease-lost" });
  });

  it("types the Market's list, create, accept and cancel calls", async () => {
    const trade = { buyer_id: null, expires_at: "2026-10-22T12:00:00.000Z", expired: false, id: TRADE,
      offered: { logs: 1 }, recipient_id: null, requested: { stone: 2 }, seller_id: SLOT, status: "open" };
    const { calls, client } = mockFetch(json({ nextCursor: "next", trades: [trade] }), json({ trade }, 201),
      json({ status: "accepted", tradeId: TRADE }), json({ status: "cancelled", tradeId: TRADE }));
    expect(await client.listTrades({ after: "prev", limit: 2 }))
      .toEqual({ nextCursor: "next", trades: [trade] });
    expect(await client.createTrade({ idempotencyKey: "trade-key-1", offered: { logs: 1 }, requested: { stone: 2 },
      ttlSeconds: 600 })).toEqual({ ok: true, trade });
    expect(await client.acceptTrade(TRADE, "accept-key-1"))
      .toEqual({ ok: true, status: "accepted", tradeId: TRADE });
    expect(await client.cancelTrade(TRADE, "cancel-key-1"))
      .toEqual({ ok: true, status: "cancelled", tradeId: TRADE });
    expect(calls.map(call => `${call.method} ${call.url}`)).toEqual([
      "GET /v1/economy/trades?after=prev&limit=2", "POST /v1/economy/trades",
      `POST /v1/economy/trades/${TRADE}/accept`, `POST /v1/economy/trades/${TRADE}/cancel`
    ]);
  });
});

describe("cloud stock moves", () => {
  it("adopts a deposit and a withdrawal through the store callback", async () => {
    const deposit = vi.fn(async () => ({ ok: true as const, ...depositResult }));
    const withdrawalResult: StockMoveResult = { goods: { fish: 2 }, revision: 14, slotId: SLOT,
      storage: { fish: 7, logs: 60 }, wallet };
    const withdrawal = vi.fn(async () => ({ ok: true as const, ...withdrawalResult }));
    let revision = 12;
    const adopted: StockMoveAdoption[] = [];
    const store = {
      adoptStockMove: vi.fn(async (move: StockMoveAdoption, apply?: (move: StockMoveAdoption) => void) => {
        if (move.revision <= revision) return { applied: false, droppedPending: false, ok: true as const, revision };
        revision = move.revision;
        apply?.(move);
        return { applied: true, droppedPending: false, ok: true as const, revision };
      }),
      revision: () => revision
    };
    const stock = createStockMoveClient({ client: { depositStock: deposit, withdrawStock: withdrawal }, slotId: SLOT,
      store });
    const first = await stock.move({ direction: "deposit", goods: { logs: 40 }, idempotencyKey: "deposit-key-1" },
      move => adopted.push(move));
    expect(first).toMatchObject({ applied: true, ok: true, result: depositResult, revision: 13 });
    expect(deposit).toHaveBeenCalledWith({ goods: { logs: 40 }, idempotencyKey: "deposit-key-1", revision: 12,
      slotId: SLOT });
    const second = await stock.move({ direction: "withdraw", goods: { fish: 2 }, idempotencyKey: "withdraw-key-1" },
      move => adopted.push(move));
    expect(second).toMatchObject({ applied: true, ok: true, result: withdrawalResult, revision: 14 });
    expect(withdrawal).toHaveBeenCalledWith({ goods: { fish: 2 }, idempotencyKey: "withdraw-key-1", revision: 13,
      slotId: SLOT });
    expect(adopted).toEqual([
      { direction: "deposit", goods: { logs: 40 }, revision: 13, storage: { fish: 5, logs: 60 } },
      { direction: "withdraw", goods: { fish: 2 }, revision: 14, storage: { fish: 7, logs: 60 } }
    ]);
  });

  it("retries an idempotent stock move after a lost response without applying its delta twice", async () => {
    const bodies: StockMoveBody[] = [];
    const deposit = vi.fn(async (body: StockMoveBody) => {
      bodies.push(body);
      if (bodies.length === 1) throw new Error("response lost");
      return { ok: true as const, ...depositResult };
    });
    let revision = 12, applied = 0;
    const store = {
      adoptStockMove: vi.fn(async (move: StockMoveAdoption) => {
        if (move.revision <= revision) return { applied: false, droppedPending: false, ok: true as const, revision };
        revision = move.revision;
        applied++;
        return { applied: true, droppedPending: false, ok: true as const, revision };
      }),
      revision: () => revision
    };
    const stock = createStockMoveClient({ client: { depositStock: deposit, withdrawStock: deposit }, slotId: SLOT,
      store });
    const request = { direction: "deposit" as const, goods: { logs: 40 }, idempotencyKey: "retry-key-1" };
    await expect(stock.move(request)).rejects.toThrow("response lost");
    expect(await stock.move(request)).toMatchObject({ applied: true, ok: true, revision: 13 });
    expect(deposit).toHaveBeenCalledTimes(2);
    expect(bodies[0]).toEqual(bodies[1]);
    expect(applied).toBe(1);
  });

  it("surfaces a stock conflict or lost lease explicitly", async () => {
    const onLeaseLost = vi.fn();
    const conflict = createStockMoveClient({
      client: { depositStock: async () => ({ message: "Not enough stored logs", ok: false, reason: "conflict" }),
        withdrawStock: async () => ({ message: "Not enough wallet logs", ok: false, reason: "conflict" }) },
      slotId: SLOT, store: { adoptStockMove: vi.fn(), revision: () => 12 }
    });
    expect(await conflict.move({ direction: "deposit", goods: { logs: 40 }, idempotencyKey: "conflict-key-1" }))
      .toEqual({ message: "Not enough stored logs", ok: false, reason: "conflict" });
    const lost = createStockMoveClient({
      client: { depositStock: async () => ({ message: "Taken over", ok: false, reason: "lease-lost" }),
        withdrawStock: async () => ({ message: "Taken over", ok: false, reason: "lease-lost" }) },
      onLeaseLost, slotId: SLOT, store: { adoptStockMove: vi.fn(), revision: () => 12 }
    });
    expect(await lost.move({ direction: "withdraw", goods: { logs: 1 }, idempotencyKey: "lease-key-1" }))
      .toEqual({ message: "Taken over", ok: false, reason: "lease-lost" });
    expect(onLeaseLost).toHaveBeenCalledTimes(1);
  });

  it("is a no-op for a guest without a cloud session", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await stockMoveFor(null).move({ direction: "deposit", goods: { logs: 1 }, idempotencyKey: "guest-key-1" }))
      .toEqual({ message: "Sign in with a cloud save to move island goods.", ok: false, reason: "no-account" });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("local stock storage", () => {
  const buildings = (): StockStorageBuilding[] => {
    const inventory = { fish: 3, logs: 120 };
    return [{ construction: 1, inventory, storagePoolId: 0, typeId: 0 },
      { construction: 1, inventory, storagePoolId: 0, typeId: 29 },
      { construction: 1, inventory: { logs: 999 }, typeId: 9 }];
  };

  it("applies a server deposit and withdrawal to the actual home pool once", () => {
    const home = buildings();
    expect(applyStockStorageMove(home, { direction: "deposit", goods: { logs: 40 } }))
      .toEqual({ ok: true, storage: { fish: 3, logs: 80 } });
    expect(home[0]!.inventory.logs).toBe(80);
    expect(home[1]!.inventory.logs).toBe(80);
    expect(home[2]!.inventory.logs).toBe(999);
    expect(applyStockStorageMove(home, { direction: "withdraw", goods: { fish: 2, logs: 10 } }))
      .toEqual({ ok: true, storage: { fish: 5, logs: 90 } });
    expect(home[0]!.inventory).toEqual({ fish: 5, logs: 90 });
  });

  it("refuses a deposit the local storage cannot cover without changing it", () => {
    const home = buildings();
    const before = structuredClone(home);
    expect(applyStockStorageMove(home, { direction: "deposit", goods: { stone: 1 } }))
      .toEqual({ ok: false, reason: "The island storage has only 0 stone; 1 were deposited" });
    expect(home).toEqual(before);
  });
});
