import {
  TRADE_HISTORY_LIMIT, TRADE_MARKET_DAY_SECONDS, TRADE_NPC_BID_FACTOR, TRADE_OFFER_LIFETIME_MS
} from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import type { Goods, SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { createSettlementTrade } from "../src/shared/trade/settlement-trade";
import { buyMerchantOffer, placePlayerOffer, updateTrade } from "../src/shared/trade/trade-commands";
import { settlementTradePort } from "../src/shared/trade/trade-island";
import { addHistory, createTradeState } from "../src/shared/trade/trade-ledger";
import {
  dispatchTradeShips, shipLoad, tradeShipGone, tradeShipLoaded, tradeShipUnloaded
} from "../src/shared/trade/trade-shipping";
import type { MerchantOffer, SettlementTradeSave } from "../src/shared/trade/trade-types";
import {
  activeOfferLimitReason, capacityReason, levelLockedReason, notEnoughStockReason, notTradableReason, protectedFloorReason,
  storageFullReason, TRADE_REASONS
} from "../src/shared/trade/trade-validation";

const building = (uid: number, typeId: number, extra: Partial<SettlementBuilding> = {}) => ({
  access: { x: 0, z: 0 }, construction: 1, incoming: {}, input: {}, inventory: {}, output: {}, required: {},
  typeId, uid,
  ...extra
}) as SettlementBuilding;
const island = (buildings: SettlementBuilding[], level = 1) => {
  let now = 1_000;
  const context = {
    actors: [], buildings,
    options: { now: () => now++, playerLevel: () => level, world: { seed: 42 } }
  } as unknown as SettlementContext;
  return { context, state: createTradeState(), tick: () => now };
};
const homeWithHarbour = (inventory: Record<string, number>, harbour: Partial<SettlementBuilding> = {}) =>
  [building(1, 0, { inventory }), building(2, 39, harbour)];
const offer = (want: MerchantOffer["want"], give: MerchantOffer["give"]): MerchantOffer =>
  ({ give, id: "m0-0", merchant: "Livia Portus", status: "open", want });
const withMarket = (state: SettlementTradeSave, ...offers: MerchantOffer[]) => {
  state.market = { day: 0, level: 1, offers };
  return state;
};
const totalStock = (buildings: SettlementBuilding[], ware: string) =>
  buildings.reduce((sum, entry) => sum + (entry.inventory[ware] ?? 0), 0);
/** Stone (same value as planks) a fair offer of `planks` asks for. */
const fairWant = (planks: number) => ({ amount: Math.floor(planks * TRADE_NPC_BID_FACTOR * 0.95), ware: "stone" });

describe("trade command validation", () => {
  it("refuses Buy with every reason: expired, taken, harbour, level, stock, floor, capacity", () => {
    const { context, state } = island(homeWithHarbour({ planks: 50, fish: 12 }));
    const port = () => settlementTradePort(context, state);
    withMarket(state, offer({ amount: 40, ware: "planks" }, { amount: 30, ware: "stone" }));
    expect(buyMerchantOffer(state, port(), "m9-9")).toBe(TRADE_REASONS.offerExpired);
    state.market!.offers[0]!.want = { amount: 60, ware: "planks" };
    expect(buyMerchantOffer(state, port(), "m0-0")).toBe(notEnoughStockReason({ amount: 60, ware: "planks" }, 50));
    state.market!.offers[0]!.want = { amount: 5, ware: "fish" };
    expect(buyMerchantOffer(state, port(), "m0-0")).toBe(protectedFloorReason("fish", 10));
    state.market!.offers[0]!.want = { amount: 40, ware: "planks" };
    state.market!.offers[0]!.give = { amount: 30, ware: "limestone" };
    expect(buyMerchantOffer(state, port(), "m0-0")).toBe(levelLockedReason("limestone"));
    state.market!.offers[0]!.give = { amount: 1600, ware: "stone" };
    expect(buyMerchantOffer(state, port(), "m0-0")).toBe(capacityReason({ amount: 1600, ware: "stone" }, 1500));
    // Owner rule: the delivered ware's stock at its storage limit refuses the order before any partial fit.
    context.buildings[0]!.inventory.stone = 1500;
    state.market!.offers[0]!.give = { amount: 1, ware: "stone" };
    expect(buyMerchantOffer(state, port(), "m0-0")).toBe(storageFullReason("stone"));
    context.buildings[0]!.inventory.stone = 0;
    state.market!.offers[0]!.give = { amount: 30, ware: "stone" };
    context.buildings[1]!.construction = 0.5;
    expect(buyMerchantOffer(state, port(), "m0-0")).toBe(TRADE_REASONS.harbourUnfinished);
    context.buildings.pop();
    expect(buyMerchantOffer(state, port(), "m0-0")).toBe(TRADE_REASONS.harbourMissing);
    context.buildings.push(building(2, 39));
    expect(buyMerchantOffer(state, port(), "m0-0")).toBe(true);
    expect(buyMerchantOffer(state, port(), "m0-0")).toBe(TRADE_REASONS.offerTaken);
  });
  it("refuses Place with every reason and enforces the five-offer limit", () => {
    const { context, state } = island(homeWithHarbour({ planks: 500, stone: 990 }));
    const trade = createSettlementTrade(context);
    trade.restore(state);
    const stone = { amount: 1, ware: "stone" };
    expect(trade.placeOffer({ amount: 1.5, ware: "planks" }, stone)).toBe(TRADE_REASONS.invalidLot);
    expect(trade.placeOffer({ amount: 1, ware: "horse" }, stone)).toBe(notTradableReason("horse"));
    expect(trade.placeOffer({ amount: 1, ware: "planks" }, { amount: 1, ware: "sake" })).toBe(notTradableReason("sake"));
    expect(trade.placeOffer({ amount: 5, ware: "planks" }, { amount: 5, ware: "planks" })).toBe(TRADE_REASONS.sameWare);
    expect(trade.placeOffer({ amount: 5, ware: "planks" }, { amount: 5, ware: "granite" }))
      .toBe(levelLockedReason("granite"));
    expect(trade.placeOffer({ amount: 600, ware: "planks" }, { amount: 5, ware: "stone" }))
      .toBe(notEnoughStockReason({ amount: 600, ware: "planks" }, 500));
    expect(trade.placeOffer({ amount: 5, ware: "planks" }, { amount: 600, ware: "stone" }))
      .toBe(capacityReason({ amount: 600, ware: "stone" }, 510));
    for (let index = 0; index < 5; index++)
      expect(trade.placeOffer({ amount: 10, ware: "planks" }, { amount: 1, ware: "stone" })).toBe(true);
    expect(trade.placeOffer({ amount: 10, ware: "planks" }, { amount: 1, ware: "stone" }))
      .toBe(activeOfferLimitReason(5));
    expect(trade.cancelOffer("o404")).toBe(TRADE_REASONS.offerInactive);
  });
  it("refuses every trade command on a campaign map (C3)", () => {
    const { context } = island(homeWithHarbour({ planks: 500, stone: 1500 }));
    (context.options.world as { scenario?: unknown }).scenario = { kind: "campaign" };
    const trade = createSettlementTrade(context);
    const fish = { amount: 1, ware: "fish" };
    expect(trade.placeOffer({ amount: 10, ware: "planks" }, fish)).toBe(TRADE_REASONS.homeOnly);
    expect(trade.checkPlace({ amount: 10, ware: "planks" }, fish)).toBe(TRADE_REASONS.homeOnly);
  });
  it("trades only on the home island and refuses a want whose storage is full", () => {
    const { context } = island(homeWithHarbour({ planks: 500, stone: 1500 }));
    const trade = createSettlementTrade(context);
    const fish = { amount: 1, ware: "fish" };
    expect(trade.placeOffer({ amount: 10, ware: "planks" }, { amount: 1, ware: "stone" })).toBe(storageFullReason("stone"));
    expect(trade.placeOffer({ amount: 10, ware: "planks" }, fish)).toBe(true);
    trade.update(1);
    // The same island as a colony (its harbour is the colony's home): every trade command refuses.
    context.buildings[1]!.colonyHome = true;
    const offerId = trade.snapshot().offers[0]!.id;
    expect(trade.placeOffer({ amount: 10, ware: "planks" }, fish)).toBe(TRADE_REASONS.homeOnly);
    expect(trade.checkPlace({ amount: 10, ware: "planks" }, fish)).toBe(TRADE_REASONS.homeOnly);
    expect(trade.checkBuy(trade.snapshot().market!.offers[0]!.id)).toBe(TRADE_REASONS.homeOnly);
    expect(trade.cancelOffer(offerId)).toBe(TRADE_REASONS.homeOnly);
    // Trade state of an older build on a colony: the escrow returns into its storage and the state is dropped.
    trade.update(1);
    expect(trade.save()).toBeUndefined();
    expect(totalStock(context.buildings, "planks")).toBe(500);
    // Without a market (none off the home island) Buy still names the home-only rule, not "expired".
    expect(trade.snapshot().market).toBeNull();
    expect(trade.buy("m0-0")).toBe(TRADE_REASONS.homeOnly);
    expect(trade.placeOffer({ amount: 1.5, ware: "planks" }, fish)).toBe(TRADE_REASONS.homeOnly);
  });
  it("counts wares reserved for construction as not free and pending deliveries as incoming", () => {
    const site = building(3, 17, { construction: 0.2, input: { planks: 5 }, required: { planks: 25 } });
    const buildings = [...homeWithHarbour({ planks: 30 }), site];
    const { context, state } = island(buildings);
    const trade = createSettlementTrade(context);
    trade.restore(state);
    expect(trade.freeStock("planks")).toBe(10);
    expect(trade.placeOffer({ amount: 11, ware: "planks" }, { amount: 1, ware: "stone" }))
      .toBe(notEnoughStockReason({ amount: 11, ware: "planks" }, 10));
    expect(trade.freeCapacity("stone")).toBe(1500);
    const delivery = { createdAt: 0, goods: { stone: 1400 }, id: "d1", kind: "purchase" as const, ref: "m0-0" };
    trade.restore({ ...createTradeState(), deliveries: [delivery], nextId: 2 });
    expect(trade.freeCapacity("stone")).toBe(100);
  });
});

describe("escrow and deliveries", () => {
  it("reserves the whole payment atomically: harbour stock staged at once, the rest held for carriers", () => {
    const buildings = [building(1, 0, { inventory: { planks: 30 } }), building(2, 39, { inventory: { planks: 15 } })];
    const { context, state } = island(buildings);
    withMarket(state, offer({ amount: 40, ware: "planks" }, { amount: 30, ware: "stone" }));
    expect(buyMerchantOffer(state, settlementTradePort(context, state), "m0-0")).toBe(true);
    expect(buildings[1]!.inventory.planks).toBe(0);
    expect(totalStock(buildings, "planks")).toBe(5);
    expect(state.escrow).toEqual([{ goods: { planks: 40 }, harbourUid: 2, held: [{ goods: { planks: 25 }, uid: 1 }],
      id: "e1", purpose: "purchase", ref: "m0-0", staged: { planks: 15 } }]);
    expect(state.deliveries).toMatchObject([{ escrowId: "e1", goods: { stone: 30 }, kind: "purchase" }]);
    expect(state.history).toMatchObject([{ gave: { amount: 40, ware: "planks" }, kind: "bought",
      merchant: "Livia Portus", received: { amount: 30, ware: "stone" } }]);
    // No double spend: the held planks are out of free stock, so a second payment cannot use them.
    expect(settlementTradePort(context, state).freeStock("planks")).toBe(5);
    const failing = { ...settlementTradePort(context, state), reserve: () => null };
    const before = structuredClone(state);
    expect(placePlayerOffer(state, failing, { amount: 5, ware: "planks" }, { amount: 1, ware: "stone" }))
      .toBe(notEnoughStockReason({ amount: 5, ware: "planks" }, 5));
    expect(state).toEqual(before);
  });
  it("unloads a ship's hold into the harbour beyond its storage limit and loads the staged escrow", () => {
    const buildings = homeWithHarbour({ stone: 1450 });
    const { context, state } = island(buildings);
    state.escrow.push({ goods: { planks: 10 }, harbourUid: 2, held: [], id: "e1", purpose: "purchase", ref: "m0-0",
      staged: { planks: 10 } });
    state.deliveries.push({ aboard: { fish: 20, stone: 120 }, createdAt: 0, escrowId: "e1",
      goods: { fish: 20, stone: 120 }, id: "d2", kind: "purchase", queue: 3, ref: "m0-0", shipId: 7 });
    state.nextId = 4;
    const port = settlementTradePort(context, state);
    expect(tradeShipUnloaded(state, port, "d2", 99, 2)).toBeNull();
    expect(tradeShipUnloaded(state, port, "d2", 7, 2)).toEqual({ planks: 10 });
    // Committed arrivals may overflow (architecture decision 7): 1450 + 120 stone > 1500, no mail.
    expect(totalStock(buildings, "stone")).toBe(1570);
    expect(buildings[1]!.inventory).toEqual({ fish: 20, stone: 120 });
    expect(state.deliveries[0]).toMatchObject({ goods: {}, outbound: { planks: 10 }, shipId: 7 });
    tradeShipLoaded(state, "d2", 7);
    expect(state.deliveries).toEqual([]);
    expect(state.escrow).toEqual([]);
  });
  it("sends one trade ship for a whole large trade and finishes an old save's partly delivered remainder", () => {
    const { state } = island(homeWithHarbour({}));
    const sent: { cargo: Goods; delivery: string }[] = [];
    const ships = { ready: () => undefined, send: (_uid: number, cargo: Goods, delivery: string) => {
      sent.push({ cargo, delivery }); return 40 + sent.length; }, shipIds: () => new Set<number>() };
    // Owner 2026-10-19: no hold limit for trade ships, 2,000 stone (61 holds' worth of boxes) is one ship.
    state.escrow.push({ goods: { planks: 700 }, harbourUid: 2, held: [], id: "e1", purpose: "purchase", ref: "m0-0",
      staged: { planks: 700 } });
    state.deliveries.push({ createdAt: 0, escrowId: "e1", goods: { stone: 2000 }, id: "d2", kind: "purchase",
      ref: "m0-0" });
    // An older build's delivery: one hold already came, the rest is owed (no ship under way).
    state.deliveries.push({ createdAt: 0, goods: { stone: 1340 }, id: "d3", kind: "sale", ref: "o9" });
    state.nextId = 4;
    expect(dispatchTradeShips(state, 2, ships).map(status => status.stage)).toEqual(["shipping", "shipping"]);
    expect(sent).toEqual([{ cargo: { stone: 2000 }, delivery: "d2" }, { cargo: { stone: 1340 }, delivery: "d3" }]);
    expect(shipLoad({ planks: 700, stone: 0 })).toEqual({ planks: 700 });
  });
  it("keeps a delivery owed when its ship leaves without unloading (harbour gone)", () => {
    const { state } = island(homeWithHarbour({}));
    state.deliveries.push({ aboard: { fish: 5 }, createdAt: 0, goods: { fish: 5 }, id: "d1", kind: "sale", queue: 2,
      ref: "o1", shipId: 4 });
    state.nextId = 3;
    tradeShipGone(state, "d1", 4);
    expect(state.deliveries).toEqual([{ createdAt: 0, goods: { fish: 5 }, id: "d1", kind: "sale", ref: "o1" }]);
  });
  it("cancels a loaded same-ware offer with its wares returned and drops such merchant offers", () => {
    const buildings = homeWithHarbour({ planks: 50 });
    const { context } = island(buildings);
    const trade = createSettlementTrade(context);
    const lot = { amount: 20, ware: "planks" };
    const saved = { ...createTradeState(), escrow: [{ goods: { planks: 20 }, harbourUid: 2, held: [], id: "e1",
      purpose: "offer" as const, ref: "o2", staged: { planks: 20 } }], market: { day: 0, level: 1,
      offers: [offer(lot, { amount: 5, ware: "planks" })] }, nextId: 3,
      offers: [{ escrowId: "e1", fillAt: null, give: lot, id: "o2", placedAt: 0, placedTime: 0, want: lot }] };
    trade.restore(saved);
    expect(trade.snapshot()).toMatchObject({ escrow: [], market: { offers: [] }, offers: [] });
    expect(trade.snapshot().history).toMatchObject([{ gave: lot, kind: "cancelled" }]);
    expect(buildings[1]!.inventory.planks).toBe(20);
  });
  it("cancel returns the wares physically: held stay in their storage, staged enter the harbour", () => {
    const buildings = [building(1, 0, { inventory: { planks: 60 } }), building(2, 39, { inventory: { planks: 15 } })];
    const { context } = island(buildings);
    const trade = createSettlementTrade(context);
    expect(trade.placeOffer({ amount: 40, ware: "planks" }, { amount: 1000, ware: "stone" })).toBe(true);
    expect(totalStock(buildings, "planks")).toBe(35);
    const [placed] = trade.snapshot().offers;
    expect(placed!.fillAt).toBeNull();
    expect(trade.cancelOffer(placed!.id)).toBe(true);
    const after = trade.snapshot();
    expect([after.offers, after.escrow, after.deliveries]).toEqual([[], [], []]);
    expect(buildings.map(entry => entry.inventory.planks)).toEqual([60, 15]);
    expect(after.history.at(-1)).toMatchObject({ gave: { amount: 40, ware: "planks" }, kind: "cancelled" });
  });
});

describe("trade clock", () => {
  it("fills NPC buyer offers identically in one offline jump or in small ticks", () => {
    const run = (steps: number[]) => {
      const { context } = island(homeWithHarbour({ planks: 500 }));
      const trade = createSettlementTrade(context);
      expect(trade.setNpcTraders(true)).toBe(true);
      trade.update(0.05);
      for (let index = 0; index < 4; index++) expect(trade.placeOffer({ amount: 50 + index, ware: "planks" },
        fairWant(50 + index))).toBe(true);
      for (const step of steps) trade.update(step);
      return trade.snapshot();
    };
    /** Wall-clock history times differ (the offline run dates fills back); everything else must match. */
    const gameState = (state: SettlementTradeSave) =>
      ({ ...state, buyerClock: Math.round(state.buyerClock), elapsed: Math.round(state.elapsed),
        history: state.history.map(({ at: _at, ...entry }) => entry) });
    const offline = run([3600]);
    expect(gameState(run(Array.from({ length: 3600 * 4 }, () => 0.25)))).toEqual(gameState(offline));
    expect(offline.history.every(entry => entry.at < 1_000 && entry.at > 1_000 - 3_600_000)).toBe(true);
    expect(offline.offers).toEqual([]);
    expect(offline.history.map(entry => entry.kind)).toEqual(["sold", "sold", "sold", "sold"]);
    expect(offline.escrow.every(entry => entry.purpose === "sale")).toBe(true);
    expect(offline.deliveries.map(entry => entry.kind)).toEqual(["sale", "sale", "sale", "sale"]);
  });
  it("keeps fair offers open before their fill time and refreshes merchant offers each market day", () => {
    const { context, state } = island(homeWithHarbour({ planks: 500 }));
    const port = settlementTradePort(context, state);
    state.npcTraders = true;
    updateTrade(state, port, 1);
    const day0 = state.market!;
    expect(placePlayerOffer(state, port, { amount: 100, ware: "planks" }, fairWant(100))).toBe(true);
    updateTrade(state, port, 100);
    expect(state.offers).toHaveLength(1);
    updateTrade(state, port, 300);
    expect(state.offers).toHaveLength(0);
    updateTrade(state, port, TRADE_MARKET_DAY_SECONDS);
    expect(state.market!.day).toBe(1);
    expect(state.market!.offers).not.toEqual(day0.offers);
  });
  it("fills nothing while NPC traders are off; switched on, fill times count from that moment", () => {
    const run = (steps: number[]) => {
      const { context } = island(homeWithHarbour({ planks: 500 }));
      const trade = createSettlementTrade(context);
      expect(trade.setNpcTraders("yes")).toBe(false);
      expect(trade.placeOffer({ amount: 100, ware: "planks" }, fairWant(100))).toBe(true);
      const fillAt = trade.snapshot().offers[0]!.fillAt!;
      expect(fillAt).toBeGreaterThan(0);
      // A long offline jump with the toggle off: the offer stays open and the buyer clock stands still.
      trade.update(7200);
      expect(trade.snapshot()).toMatchObject({ buyerClock: 0, offers: [{ fillAt }] });
      trade.setNpcTraders(true);
      for (const step of steps) trade.update(step);
      return { fillAt, state: trade.snapshot() };
    };
    const { fillAt, state } = run([1]);
    expect(state.offers).toHaveLength(1);
    expect(state.buyerClock).toBe(1);
    const filled = run([3600]).state;
    expect(filled.offers).toEqual([]);
    expect(filled.history.at(-1)).toMatchObject({ kind: "sold" });
    // The fill is dated back only into the time the toggle was on, never into the hours it was off.
    expect(1_000 - filled.history.at(-1)!.at).toBeLessThanOrEqual((3600 - fillAt) * 1000 + 10);
  });
  it("expires an unfilled own offer 12 h after placement and returns its reserved wares", () => {
    const buildings = homeWithHarbour({ planks: 60 });
    let time = Date.UTC(2026, 11, 13, 10);
    const placedAt = time;
    const context = { actors: [], buildings,
      options: { now: () => time, playerLevel: () => 1, world: { seed: 42 } } } as unknown as SettlementContext;
    const trade = createSettlementTrade(context);
    expect(trade.placeOffer({ amount: 40, ware: "planks" }, { amount: 1000, ware: "stone" })).toBe(true);
    expect(totalStock(buildings, "planks")).toBe(20);
    time = placedAt + TRADE_OFFER_LIFETIME_MS - 1;
    trade.update(0.05);
    expect(trade.snapshot().offers).toHaveLength(1);
    // One long step (an offline jump) passes the expiry: the offer ends there.
    time = placedAt + TRADE_OFFER_LIFETIME_MS + 3_600_000;
    trade.update(3600);
    const after = trade.snapshot();
    expect([after.offers, after.escrow, after.deliveries]).toEqual([[], [], []]);
    expect(totalStock(buildings, "planks")).toBe(60);
    expect(after.history.at(-1)).toMatchObject({ at: placedAt + TRADE_OFFER_LIFETIME_MS,
      gave: { amount: 40, ware: "planks" }, kind: "expired" });
  });
  it("expires instead of filling when the buyer's fill time comes after the expiry", () => {
    const run = (jumpEndsAt: number) => {
      const buildings = homeWithHarbour({ planks: 500 });
      let time = 1_000;
      const context = { actors: [], buildings,
        options: { now: () => time, playerLevel: () => 1, world: { seed: 42 } } } as unknown as SettlementContext;
      const trade = createSettlementTrade(context);
      expect(trade.placeOffer({ amount: 100, ware: "planks" }, fairWant(100))).toBe(true);
      trade.setNpcTraders(true);
      // One offline jump of an hour ending at `jumpEndsAt`: the fill is dated back into it.
      time = 1_000 + jumpEndsAt;
      trade.update(3600);
      return { kinds: trade.snapshot().history.map(entry => entry.kind), planks: totalStock(buildings, "planks") };
    };
    expect(run(TRADE_OFFER_LIFETIME_MS)).toEqual({ kinds: ["sold"], planks: 400 });
    expect(run(TRADE_OFFER_LIFETIME_MS + 3_600_000)).toEqual({ kinds: ["expired"], planks: 500 });
  });
  it("keeps only the newest history entries", () => {
    const state = createTradeState();
    for (let index = 0; index < TRADE_HISTORY_LIMIT + 5; index++) addHistory(state, { at: index, kind: "sold" });
    expect(state.history).toHaveLength(TRADE_HISTORY_LIMIT);
    expect(state.history[0]!.at).toBe(5);
  });
});
