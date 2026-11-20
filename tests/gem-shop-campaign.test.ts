import { describe, expect, it } from "vitest";

import {
  getGemShopClosedReason, getGemShopOfferCards, selectGemShopPlayer
} from "../src/app/settlement-ui/gem-shop/helpers";
import type { SettlementUiSnapshot } from "../src/app/settlement-ui/types";
import { GEM_SHOP_CAMPAIGN_CLOSED } from "../src/shared/progression/gem-shop";

const snapshot = (islandRole: SettlementUiSnapshot["islandRole"]) =>
  ({ islandRole, player: { gems: 100000, level: 30 } }) as unknown as SettlementUiSnapshot;

describe("gem shop on a campaign map (C3)", () => {
  it("disables every offer and names the reason", () => {
    const player = selectGemShopPlayer(snapshot("campaign"));
    expect(getGemShopClosedReason(player)).toBe(GEM_SHOP_CAMPAIGN_CLOSED);
    for (const category of [0, 1, 2, 3]) {
      const cards = getGemShopOfferCards(category, player);
      expect(cards.every(card => card.disabled && card.buyLabel === GEM_SHOP_CAMPAIGN_CLOSED)).toBe(true);
    }
  });
  it("stays open at home", () => {
    const player = selectGemShopPlayer(snapshot("home"));
    expect(getGemShopClosedReason(player)).toBe("");
    expect(getGemShopOfferCards(0, player).some(card => !card.disabled)).toBe(true);
  });
});
