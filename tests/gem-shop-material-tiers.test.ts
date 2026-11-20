import { BUILDING_MATERIAL_ORDER, LEVEL_THRESHOLDS, materialMinimumLevel } from "@shared/catalog/balance";
import { expect, it } from "vitest";

import { BUILDING_MATERIAL_OFFERS, purchaseGemOffer } from "../src/shared/progression/gem-shop";
import { createPlayerProgress } from "../src/shared/progression/player-progress";

it("sells all base and advanced materials in tier order with consistent increasing prices", () => {
  expect(BUILDING_MATERIAL_OFFERS.map(offer => offer.ware)).toEqual(BUILDING_MATERIAL_ORDER);
  for (const offer of BUILDING_MATERIAL_OFFERS) {
    expect(offer.amount).toBe(100);
    const base = offer.ware.endsWith("Logs") || offer.ware === "logs" ? 10 : 15;
    expect(offer.price).toBe(base * 2 ** offer.resourceTier!);
    const progress = { ...createPlayerProgress(7), gems: offer.price,
      experience: LEVEL_THRESHOLDS[materialMinimumLevel(offer.ware) - 1]! };
    expect(purchaseGemOffer(progress, offer.id)).toMatchObject({
      ok: true, goods: { [offer.ware]: 100 }, progress: { gems: 0 }
    });
    expect(purchaseGemOffer({ ...progress, gems: offer.price - 1 }, offer.id).ok).toBe(false);
    expect(progress.gems).toBe(offer.price);
  }
});
