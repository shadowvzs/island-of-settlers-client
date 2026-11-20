import { TRADE_MAX_LOT_AMOUNT } from "@shared/catalog/balance";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  clampClaimAmount, clampRequestedAmount, defaultOfferForm, getBuyRows, getClaimLabel, getHomeRows, getMarketExpiryDelay,
  getOfferFormView, getOfferProblem, getOfferRows, getWalletRows, MARKET_EXPIRY_MAX_DELAY_MS,
  MARKET_EXPIRY_MIN_DELAY_MS
} from "../src/app/settlement-ui/market/helpers";
import { PlayerMarketView } from "../src/app/settlement-ui/market/market-view";
import type { MarketViewState } from "../src/app/settlement-ui/market/use-market";
import type {
  MarketPendingBuy, MarketPendingClaim, MarketPendingOffer, MarketTrade
} from "../src/shared/trade/market";
import { renderWithI18n } from "./helpers/render-with-i18n";

const noop = vi.fn();
const TRADE = "7e2c1d3a-4b5c-4d6e-8f90-1a2b3c4d5e6f";

const trade = (overrides: Partial<MarketTrade> = {}): MarketTrade => ({
  buyer_id: null,
  expires_at: "2026-10-24T12:00:00.000Z",
  expired: false,
  id: TRADE,
  offered: { logs: 40 },
  recipient_id: null,
  requested: { stone: 2 },
  seller_id: "me",
  status: "open",
  ...overrides
});

const foreignTrade = (overrides: Partial<MarketTrade> = {}): MarketTrade =>
  trade({ seller_id: "someone-else", ...overrides });

const pendingBuy = (overrides: Partial<MarketPendingBuy> = {}): MarketPendingBuy => ({
  acceptKey: "market-accept-key-00000000",
  depositKey: "market-deposit-key-00000000",
  discardable: true,
  id: "pending-buy",
  message: "The purchase could not be confirmed.",
  offered: { logs: 40 },
  requested: { stone: 2 },
  stage: "accept",
  tradeId: TRADE,
  ...overrides
});

const pendingOffer = (overrides: Partial<MarketPendingOffer> = {}): MarketPendingOffer => ({
  discardable: true,
  depositKey: "market-deposit-key-00000000",
  id: "pending-offer",
  message: "The offer could not be confirmed.",
  offered: { logs: 40 },
  requested: { stone: 2 },
  stage: "trade",
  tradeKey: "market-trade-key-00000000",
  ttlSeconds: 3600,
  ...overrides
});

const pendingClaim = (overrides: Partial<MarketPendingClaim> = {}): MarketPendingClaim => ({
  goods: { logs: 40 },
  id: "pending-claim",
  key: "market-claim-key-00000000",
  message: "The claim could not be confirmed.",
  ...overrides
});

const home = { bread: 9, logs: 40 };
const viewState = (overrides: Partial<MarketViewState> = {}): MarketViewState => ({
  available: true,
  busy: false,
  buyRows: getBuyRows([foreignTrade({ id: "other-offer", requested: { logs: 5 } })], { logs: 40 }, home),
  error: "",
  form: getOfferFormView(defaultOfferForm(home), home),
  homeOnly: true,
  homeRows: getHomeRows(home),
  loaded: true,
  loading: false,
  offers: getOfferRows([trade()]),
  pendingBuy: null,
  pendingClaim: null,
  pendingOffer: null,
  status: "",
  walletRows: getWalletRows({ logs: 40 }),
  walletTotal: 40,
  onAmount: noop,
  onBuy: noop,
  onCancel: noop,
  onClaim: noop,
  onClaimAll: noop,
  onDiscardBuy: noop,
  onDiscardClaim: noop,
  onDiscardOffer: noop,
  onOffer: noop,
  onRefresh: noop,
  onRetryBuy: noop,
  onRetryClaim: noop,
  onRetryOffer: noop,
  onTtl: noop,
  onWare: noop,
  ...overrides
});

const render = (overrides: Partial<MarketViewState> = {}) =>
  renderWithI18n(createElement(PlayerMarketView, viewState(overrides)));

describe("Player Market helpers", () => {
  it("shows all 12 Market wares at home and hides non-allowlisted stock", () => {
    const rows = getHomeRows(home);
    expect(rows).toHaveLength(12);
    expect(rows.map(row => row.ware)).toEqual([
      "logs", "planks", "stone", "grain", "fish", "meat", "coal", "ironOre", "goldOre", "bow", "pickaxe", "hammer"
    ]);
    expect(rows.find(row => row.ware === "logs")).toMatchObject({ count: 40, name: "Softwood logs" });
    expect(rows.some(row => row.ware === "bread")).toBe(false);
  });

  it("shows only claimable positive wallet goods and formats open offers", () => {
    expect(getWalletRows({ bread: 9, logs: 40, stone: 0 }).map(row => row.ware)).toEqual(["logs"]);
    expect(getWalletRows({ logs: 40 })[0]).toMatchObject({ count: 40, received: 0 });
    expect(getWalletRows({ logs: 40 }, { logs: 15 })[0]).toMatchObject({ count: 40, received: 15 });
    const [offer] = getOfferRows([trade()]);
    expect(offer).toMatchObject({
      cancelLabel: "Cancel offer: 40 Softwood logs for 2 Stone",
      expiresText: "Expires 12:00 UTC",
      giveText: "40 Softwood logs",
      id: TRADE,
      needText: "2 Stone"
    });
  });

  it("formats other players' offers from the buyer's side and explains what is missing", () => {
    const [covered] = getBuyRows([foreignTrade({ id: "covered", requested: { logs: 5 } })], { logs: 5 }, {});
    expect(covered).toMatchObject({
      action: "accept",
      actionLabel: "Accept offer",
      buttonLabel: "Accept offer: you get 40 Softwood logs, you give 5 Softwood logs",
      expiresText: "Expires 12:00 UTC",
      getText: "40 Softwood logs",
      giveText: "5 Softwood logs",
      problem: ""
    });
    const [deposit] = getBuyRows([foreignTrade({ id: "deposit", requested: { stone: 2 } })], { logs: 40 },
      { stone: 2 });
    expect(deposit).toMatchObject({ action: "deposit", actionLabel: "Deposit and accept", problem: "" });
    const [blocked] = getBuyRows([foreignTrade({ id: "blocked", requested: { stone: 2 } })], { logs: 40 },
      { logs: 40 });
    expect(blocked!.problem).toBe("Not enough 2 Stone in your Market wallet or home storage.");
    expect(blocked!.action).toBe("deposit");
  });

  it("explains an over-offer and non-positive amounts", () => {
    const form = defaultOfferForm({ logs: 2 });
    expect(getOfferProblem(form, { logs: 2 })).toBe("");
    expect(getOfferProblem({ ...form, offeredAmount: 3 }, { logs: 2 }))
      .toBe("Only 2 Softwood logs are free in home storage.");
    expect(getOfferProblem({ ...form, requestedAmount: 0 }, { logs: 2 }))
      .toBe("Enter a whole positive amount to request.");
  });

  it("caps the requested amount at the trade office's lot limit", () => {
    expect(clampRequestedAmount(12)).toBe(12);
    expect(clampRequestedAmount(TRADE_MAX_LOT_AMOUNT + 1)).toBe(TRADE_MAX_LOT_AMOUNT);
    expect(getOfferFormView(defaultOfferForm({ logs: 40 }), { logs: 40 }).requestedLimit).toBe(TRADE_MAX_LOT_AMOUNT);
    expect(render()).toContain(`max="${TRADE_MAX_LOT_AMOUNT}"`);
  });

  it("clamps a per-ware claim and labels the exact partial amount", () => {
    const [row] = getWalletRows({ logs: 40 });
    expect(row).toBeDefined();
    expect(clampClaimAmount(row!.count, 0)).toBe(1);
    expect(clampClaimAmount(row!.count, 41)).toBe(40);
    expect(clampClaimAmount(row!.count, 7)).toBe(7);
    expect(clampClaimAmount(row!.count, Number.NaN)).toBe(40);
    expect(getClaimLabel(row!, undefined, 7)).toBe("Claim 7 Softwood logs to home");
    expect(getClaimLabel(row!)).toBe("Claim 40 Softwood logs to home");
  });

  it("computes the next offer expiry with a minimum, maximum and hidden-tab policy", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-24T11:30:00.000Z"));
      const now = Date.now();
      expect(getMarketExpiryDelay([], now)).toBeNull();
      expect(getMarketExpiryDelay([trade()], Number.NaN)).toBeNull();
      expect(getMarketExpiryDelay([trade()], now, true)).toBeNull();
      expect(getMarketExpiryDelay([
        trade({ id: "closed", status: "accepted" }),
        trade({ expired: true, id: "expired" })
      ], now)).toBeNull();
      expect(getMarketExpiryDelay([trade({ expires_at: "2026-10-24T11:35:00.000Z" })], now))
        .toBe(5 * 60_000);
      expect(getMarketExpiryDelay([trade({ expires_at: "2026-10-24T11:29:00.000Z" })], now))
        .toBe(MARKET_EXPIRY_MIN_DELAY_MS);
      expect(getMarketExpiryDelay([trade({ expires_at: "2026-10-25T12:00:00.000Z" })], now))
        .toBe(MARKET_EXPIRY_MAX_DELAY_MS);
      expect(getMarketExpiryDelay([trade({ expires_at: "not-a-date" })], now)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Player Market view", () => {
  it("renders home stock, wallet claims, the offer form and open offers with escrow", () => {
    const markup = render();
    expect(markup).toContain('aria-label="Home storage"');
    expect(markup).toContain('aria-label="Softwood logs: 40"');
    expect(markup).toContain('aria-label="Market wallet"');
    expect(markup).toContain("Deposited: 40");
    expect(markup).toContain('aria-label="Claim 40 Softwood logs to home"');
    expect(markup).toContain('aria-label="You offer"');
    expect(markup).toContain('aria-label="You request"');
    expect(markup).toContain('aria-label="Offer these goods on the Player Market"');
    expect(markup).toContain('aria-label="My offers"');
    expect(markup).toContain("You offer (escrow)");
    expect(markup).toContain("Cancel offer: 40 Softwood logs for 2 Stone");
    expect(markup).toContain("Only the 12 Market wares are tradable.");
    expect(markup).toContain("nothing is pushed into an offline island automatically.");
  });

  it("keeps the full-amount claim as the default and exposes a per-row amount stepper", () => {
    const markup = render();
    expect(markup).toContain('aria-label="Amount"');
    expect(markup).toContain('value="40"');
    expect(markup).toContain('aria-label="Less"');
    expect(markup).toContain('aria-label="More"');
    expect(markup).toContain('aria-label="Claim 40 Softwood logs to home"');
  });

  it("shows the pending offer, retries it, and only offers Discard when safe", () => {
    const retryable = render({ pendingOffer: pendingOffer({ discardable: false }) });
    expect(retryable).toContain("Offer creation not confirmed");
    expect(retryable).toContain('aria-label="Retry the unfinished offer"');
    expect(retryable).not.toContain('aria-label="Discard the unfinished offer"');
    expect(retryable).toContain("Retry once before discarding");
    expect(retryable).not.toContain('aria-label="Offer these goods on the Player Market"');
    const discardable = render({ pendingOffer: pendingOffer() });
    expect(discardable).toContain('aria-label="Discard the unfinished offer"');
  });

  it("lists other players' offers with You get, You give, expiry and an accept action", () => {
    const markup = render();
    expect(markup).toContain('aria-label="Player offers from other players"');
    expect(markup).toContain("Player offers");
    expect(markup).toContain("You get");
    expect(markup).toContain("You give");
    expect(markup).toContain("Expires 12:00 UTC");
    expect(markup).toContain('aria-label="Accept offer: you get 40 Softwood logs, you give 5 Softwood logs"');
    expect(markup).toContain(">Accept offer<");
  });

  it("disables an unaffordable player offer with a visible reason", () => {
    const markup = render({
      buyRows: getBuyRows([foreignTrade({ requested: { stone: 2 } })], { logs: 40 }, { logs: 40 })
    });
    expect(markup).toContain("Not enough 2 Stone in your Market wallet or home storage.");
    expect(markup).toMatch(/<button[^>]*aria-label="Deposit and accept offer[^>]*disabled=""/);
  });

  it("offers Deposit and accept when home storage covers the wallet shortfall", () => {
    const markup = render({
      buyRows: getBuyRows([foreignTrade({ requested: { stone: 2 } })], { logs: 40 }, { stone: 2 })
    });
    expect(markup).toContain("Deposit and accept");
    expect(markup).toContain('aria-label="Deposit and accept offer: you get 40 Softwood logs, you give 2 Stone"');
  });

  it("shows a pending buy with stage wording, retry and only safe discard", () => {
    const retryable = render({ pendingBuy: pendingBuy({ discardable: false, stage: "deposit" }) });
    expect(retryable).toContain("Purchase deposit not confirmed");
    expect(retryable).toContain('aria-label="Retry the unfinished purchase"');
    expect(retryable).not.toContain('aria-label="Discard the unfinished purchase"');
    expect(retryable).toContain("Retry once before discarding");
    const discardable = render({ pendingBuy: pendingBuy() });
    expect(discardable).toContain("Offer acceptance not confirmed");
    expect(discardable).toContain('aria-label="Discard the unfinished purchase"');
  });

  it("shows a pending claim with retry and discard", () => {
    const markup = render({ pendingClaim: pendingClaim() });
    expect(markup).toContain("Claim not confirmed");
    expect(markup).toContain('aria-label="Retry the unfinished claim"');
    expect(markup).toContain('aria-label="Discard the unfinished claim"');
  });

  it("tells guests that the server Market is unavailable and local NPC trade is separate", () => {
    const markup = render({ available: false, loaded: false });
    expect(markup).toContain("The Player Market needs a cloud save");
    expect(markup).toContain("harbour trade office and its local NPC offers are separate");
  });

  it("keeps the Market home-only", () => {
    const markup = render({ homeOnly: false });
    expect(markup).toContain("The Player Market is available at home");
    expect(markup).not.toContain('aria-label="Offer these goods on the Player Market"');
    expect(markup).not.toContain('aria-label="Market wallet"');
  });

  it("explains a server read failure and keeps the refresh path", () => {
    const markup = render({ error: "The Market server did not answer.", loaded: false });
    expect(markup).toContain("The Market server did not answer.");
    expect(markup).toContain('aria-label="Refresh the Player Market"');
  });
});
