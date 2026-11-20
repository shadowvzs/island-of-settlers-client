import { describe, expect, it, vi } from "vitest";

import type { ServerMarket } from "../src/app/cloud/server-market";
import type { StockMoveApply } from "../src/app/save-store/remote-save-store";
import { createMarketControls } from "../src/app/settlement/market-session";
import type { MarketResult, MarketSnapshot } from "../src/shared/trade/market";

const snapshot: MarketSnapshot = {
  mine: [],
  others: [],
  pendingBuy: null,
  pendingClaim: null,
  pendingOffer: null,
  wallet: { blessingScrolls: 0, delivery: "withdrawable", gems: 0, inventory: {}, revision: 1 }
};
const result: MarketResult = { message: "Done.", ok: true, pendingBuy: null, pendingClaim: null,
  pendingOffer: null, snapshot };

const fakeMarket = () => {
  const market: ServerMarket = {
    accept: vi.fn(async () => result),
    cancel: vi.fn(async () => result),
    claim: vi.fn(async () => result),
    discardPendingBuy: vi.fn(),
    discardPendingClaim: vi.fn(),
    discardPendingOffer: vi.fn(),
    load: vi.fn(async () => snapshot),
    offer: vi.fn(async () => result),
    retryBuy: vi.fn(async () => result),
    retryClaim: vi.fn(async () => result),
    retryOffer: vi.fn(async () => result)
  };
  return market;
};
const apply = vi.fn() as StockMoveApply;

describe("settlement Market controls", () => {
  it("saves the home island before a deposit or withdrawal", async () => {
    const market = fakeMarket();
    const save = vi.fn(async () => true);
    const controls = createMarketControls(market, apply, save);
    await controls.offer({ offered: { logs: 10 }, requested: { stone: 2 }, ttlSeconds: 3600 });
    await controls.claim({ logs: 2 });
    expect(save).toHaveBeenCalledTimes(2);
    expect(market.offer).toHaveBeenCalledWith({ offered: { logs: 10 }, requested: { stone: 2 },
      ttlSeconds: 3600 }, apply);
    expect(market.claim).toHaveBeenCalledWith({ logs: 2 }, apply);
  });

  it("stops before the server when the home save is not current", async () => {
    const market = fakeMarket();
    const controls = createMarketControls(market, apply, async () => false);
    await expect(controls.offer({ offered: { logs: 10 }, requested: { stone: 2 }, ttlSeconds: 3600 }))
      .rejects.toThrow("could not be saved");
    await expect(controls.claim({ logs: 2 })).rejects.toThrow("could not be saved");
    expect(market.offer).not.toHaveBeenCalled();
    expect(market.claim).not.toHaveBeenCalled();
  });

  it("refuses stock moves away from the home island", async () => {
    const market = fakeMarket();
    const save = vi.fn(async () => true);
    const controls = createMarketControls(market, apply, save, () => false);
    await expect(controls.claim({ logs: 2 })).rejects.toThrow("home island only");
    expect(save).not.toHaveBeenCalled();
    expect(market.claim).not.toHaveBeenCalled();
  });
});
