import {
  isMaterialAvailable, LEVEL_THRESHOLDS, RESOURCE_TIER_MINIMUM_LEVEL, RESOURCE_TIERS
} from "@shared/catalog/balance";
import { expect, it } from "vitest";

import { getSettlementInventoryEntries } from "../src/app/settlement-ui/inventory";
import { gemShopOffers, purchaseGemOffer } from "../src/shared/progression/gem-shop";
import { createPlayerProgress } from "../src/shared/progression/player-progress";

it("unlocks each complete material trio at its colony discovery boundary", () => {
  for (const tier of RESOURCE_TIERS) {
    const required = RESOURCE_TIER_MINIMUM_LEVEL[tier.tier];
    for (const ware of [tier.logs, tier.planks, tier.stone]) {
      expect(isMaterialAvailable(ware, required)).toBe(true);
      if (required > 1) expect(isMaterialAvailable(ware, required - 1)).toBe(false);
    }
  }
  expect(isMaterialAvailable("fish", 1)).toBe(true);
});

it("hides locked zero-stock catalog rows while preserving actual owned goods and required/cargo views", () => {
  const goods = { logs: 0, hardwoodLogs: 0, cedarLogs: 0, walnutPlanks: 0, basalt: 4, granite: 0 };
  const entries = getSettlementInventoryEntries(goods, 1);
  expect(entries.map(entry => entry.ware)).toEqual(["logs", "basalt"]);
  expect(entries.find(entry => entry.ware === "basalt")?.count).toBe(4);
  expect(getSettlementInventoryEntries(goods, 26).map(entry => entry.ware))
    .toEqual(["logs", "hardwoodLogs", "cedarLogs", "walnutPlanks", "basalt"]);
  expect(getSettlementInventoryEntries(goods)).toHaveLength(Object.keys(goods).length);
  expect(goods.granite).toBe(0);
});

it("shows and sells every construction material tier at any player level", () => {
  for (const tier of RESOURCE_TIERS.filter(tier => tier.tier > 1)) {
    const required = RESOURCE_TIER_MINIMUM_LEVEL[tier.tier];
    const low = { ...createPlayerProgress(7), gems: 10000, experience: LEVEL_THRESHOLDS[required - 2]! };
    for (const ware of [tier.logs, tier.planks, tier.stone]) {
      expect(gemShopOffers("resources", required - 1).some(offer => offer.ware === ware)).toBe(true);
      expect(gemShopOffers("resources", required).some(offer => offer.ware === ware)).toBe(true);
      expect(purchaseGemOffer(low, `${ware}-100`)).toMatchObject({
        ok: true, goods: { [ware]: 100 }
      });
    }
    expect(low.gems).toBe(10000);
  }
});
