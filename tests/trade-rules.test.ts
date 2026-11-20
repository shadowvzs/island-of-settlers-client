import {
  isMaterialAvailable, TRADE_FAIRNESS_THRESHOLDS, TRADE_MERCHANT_ASK_BAND, TRADE_MERCHANT_OFFER_COUNT,
  TRADE_NPC_BID_FACTOR, TRADE_WARE_VALUES
} from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { GEM_SHOP_OFFER_LIST } from "../src/shared/progression/gem-shop";
import { generateMerchantMarket, marketDay, TRADE_MERCHANTS } from "../src/shared/trade/merchant-offers";
import { npcBuyerDelay, npcBuyerFillAt } from "../src/shared/trade/npc-buyer";
import type { TradeLot } from "../src/shared/trade/trade-types";
import {
  fairnessZone, isNationTradable, lotValue, merchantAsk, offerEstimate, offerFairness, TRADABLE_WARES, wareValue
} from "../src/shared/trade/trade-values";
import { TRADE_WARE_GROUPS } from "../src/shared/trade/trade-ware-groups";

const lot = (ware: string, amount: number): TradeLot => ({ amount, ware });
/** The want amount of `wantWare` whose fairness for `give` is exactly `fairness` (rounded down). */
const wantAt = (give: TradeLot, wantWare: string, fairness: number) =>
  lot(wantWare, Math.floor(lotValue(give) * TRADE_NPC_BID_FACTOR * fairness / wareValue(wantWare)));

describe("trade ware values", () => {
  it("prices every gem shop ware at exactly its shop unit price (tiers double like the shop)", () => {
    for (const offer of GEM_SHOP_OFFER_LIST) {
      if (offer.ware === "horse") continue;
      expect(TRADE_WARE_VALUES[offer.ware]! * offer.amount, offer.id).toBe(offer.price * 100);
    }
  });
  it("gives every tradable ware a positive whole value and exactly one ware group", () => {
    for (const ware of TRADABLE_WARES) {
      expect(Number.isSafeInteger(wareValue(ware)) && wareValue(ware) > 0, ware).toBe(true);
      expect(TRADE_WARE_GROUPS.filter(group => group.wares.includes(ware)).length, ware).toBe(1);
    }
    expect(TRADE_WARE_GROUPS.flatMap(group => group.wares).every(ware => ware in TRADE_WARE_VALUES)).toBe(true);
  });
});

describe("merchant offer generator", () => {
  it("never offers and asks the same ware (owner rule), over many seeds, days and levels", () => {
    for (let seed = 1; seed <= 40; seed++) for (const level of [1, 25, 50]) for (let day = 0; day < 10; day++)
      for (const offer of generateMerchantMarket(seed * 104729, day, level).offers)
        expect(offer.give.ware).not.toBe(offer.want.ware);
  });
  it("is deterministic per island seed and day, and differs between days and islands", () => {
    expect(generateMerchantMarket(17, 3, 50)).toEqual(generateMerchantMarket(17, 3, 50));
    expect(generateMerchantMarket(17, 4, 50).offers).not.toEqual(generateMerchantMarket(17, 3, 50).offers);
    expect(generateMerchantMarket(18, 3, 50).offers).not.toEqual(generateMerchantMarket(17, 3, 50).offers);
    expect(marketDay(1439.9)).toBe(0);
    expect(marketDay(1440)).toBe(1);
  });
  it("posts 12 finite offers by named merchants, all inside the fair ask band", () => {
    for (let day = 0; day < 40; day++) {
      const market = generateMerchantMarket(day * 7919 + 3, day, 50);
      expect(market.offers).toHaveLength(TRADE_MERCHANT_OFFER_COUNT);
      expect(new Set(market.offers.map(offer => offer.id)).size).toBe(TRADE_MERCHANT_OFFER_COUNT);
      for (const offer of market.offers) {
        expect(offer.status).toBe("open");
        expect(TRADE_MERCHANTS).toContain(offer.merchant);
        expect(offer.give.ware).not.toBe(offer.want.ware);
        const ask = merchantAsk(offer.give, offer.want);
        expect(ask).toBeGreaterThanOrEqual(TRADE_MERCHANT_ASK_BAND.min);
        expect(ask).toBeLessThanOrEqual(TRADE_MERCHANT_ASK_BAND.max);
      }
    }
  });
  it("respects material level gates: level 1 sees no advanced material", () => {
    const wares = Array.from({ length: 30 }, (_, day) => generateMerchantMarket(5, day, 1).offers)
      .flat().flatMap(offer => [offer.give.ware, offer.want.ware]);
    expect(wares.every(ware => isMaterialAvailable(ware, 1))).toBe(true);
    expect(wares).not.toContain("cedarLogs");
    const high = Array.from({ length: 30 }, (_, day) => generateMerchantMarket(5, day, 50).offers)
      .flat().flatMap(offer => [offer.give.ware, offer.want.ware]);
    expect(high.some(ware => !isMaterialAvailable(ware, 1))).toBe(true);
  });
});

it("trades only the island nation's own drink chain", () => {
  const wares = (nation: string) => new Set(Array.from({ length: 40 }, (_, day) =>
    generateMerchantMarket(3, day, 50, nation).offers).flat().flatMap(offer => [offer.give.ware, offer.want.ware]));
  const roman = wares("roman"), japanese = wares("japanese");
  expect(["sake", "rice", "mead", "honey", "toddy", "coconut"].some(ware => roman.has(ware))).toBe(false);
  expect(["wine", "grapes", "mead", "honey", "toddy", "coconut"].some(ware => japanese.has(ware))).toBe(false);
  expect(isNationTradable("sake", "japanese") && !isNationTradable("sake", "roman")).toBe(true);
});

describe("fairness and NPC buyer", () => {
  const give = lot("planks", 100);
  it("scores by value and zones: generous, fair, greedy, never", () => {
    expect(offerFairness(give, lot("stone", 100))).toBeCloseTo(1 / TRADE_NPC_BID_FACTOR);
    expect(fairnessZone(0.5)).toBe("generous");
    expect(fairnessZone(1)).toBe("fair");
    expect(fairnessZone(1.2)).toBe("greedy");
    expect(fairnessZone(1.51)).toBe("never");
    expect(offerEstimate(give, wantAt(give, "stone", 0.9))).toBe("likely");
    expect(offerEstimate(give, wantAt(give, "stone", 1.3))).toBe("slowly");
    expect(offerEstimate(give, lot("stone", 100))).toBe("unlikely");
  });
  it("fills fair offers in 2–5 minutes, generous faster, never beyond 1.5× fair value", () => {
    for (let index = 0; index < 50; index++) {
      const fair = npcBuyerDelay(9, `o${index}`, give, wantAt(give, "stone", 0.95))!;
      expect(fair).toBeGreaterThanOrEqual(120);
      expect(fair).toBeLessThanOrEqual(300);
      const generous = npcBuyerDelay(9, `o${index}`, give, wantAt(give, "stone", 0.3))!;
      expect(generous).toBeGreaterThanOrEqual(30);
      expect(generous).toBeLessThanOrEqual(120);
      expect(npcBuyerDelay(9, `o${index}`, give, wantAt(give, "stone", 1.55))).toBeNull();
      const greedy = npcBuyerDelay(9, `o${index}`, give, wantAt(give, "stone", 1.25));
      if (greedy !== null) expect(greedy).toBeGreaterThan(300);
    }
  });
  it("is deterministic per seed and offer id and anchored at the placement time", () => {
    const want = wantAt(give, "stone", 0.95);
    expect(npcBuyerDelay(4, "o1", give, want)).toBe(npcBuyerDelay(4, "o1", give, want));
    expect(npcBuyerFillAt(4, "o1", 1000, give, want)).toBe(1000 + npcBuyerDelay(4, "o1", give, want)!);
  });
});

describe("exploit guards", () => {
  it("never gains value by splitting or recombining an offer", () => {
    const want = lot("fish", 30);
    for (const factor of [2, 3, 7]) {
      const whole = offerFairness(lot("planks", 100 * factor), lot("fish", 30 * factor));
      expect(whole).toBeCloseTo(offerFairness(lot("planks", 100), want), 12);
      expect(fairnessZone(whole)).toBe(fairnessZone(offerFairness(lot("planks", 100), want)));
    }
  });
  it("buy from a merchant, then sell to an NPC buyer at the best accepted terms: always a loss", () => {
    for (let day = 0; day < 30; day++) for (const offer of generateMerchantMarket(day + 101, day, 50).offers) {
      const best = wantAt(offer.give, offer.want.ware, TRADE_FAIRNESS_THRESHOLDS.never);
      expect(best.amount).toBeLessThan(offer.want.amount);
      const above = lot(offer.want.ware, offer.want.amount);
      expect(npcBuyerDelay(day, "o1", offer.give, above)).toBeNull();
    }
  });
  it("cannot turn gem shop wares into more gem value through merchants or NPC buyers", () => {
    const shopWares = GEM_SHOP_OFFER_LIST.filter(offer => offer.ware !== "horse");
    for (const bought of shopWares) for (const target of shopWares) {
      if (bought.ware === target.ware) continue;
      const sold = wantAt(lot(bought.ware, bought.amount), target.ware, TRADE_FAIRNESS_THRESHOLDS.never);
      // What the target costs in the shop, in value units (100 per gem), vs the gems spent.
      expect(lotValue(sold), `${bought.id}->${target.ware}`).toBeLessThan(bought.price * 100);
    }
    for (let day = 0; day < 30; day++) for (const offer of generateMerchantMarket(day + 7, day, 50).offers)
      expect(lotValue(offer.give)).toBeLessThan(lotValue(offer.want));
  });
});
