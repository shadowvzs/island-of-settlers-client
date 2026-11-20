import { TRADE_FAIRNESS_THRESHOLDS, TRADE_NPC_BUYER_DELAY_SECONDS } from "@shared/catalog/balance";

import { lerp } from "../world/noise";
import { createRandom, deriveSeed } from "../world/rng";
import type { TradeLot } from "./trade-types";
import { fairnessZone, offerFairness } from "./trade-values";

/** How far a greedy offer reaches into the greedy zone (0 at fair, 1 at the never-threshold). */
const greedShare = (fairness: number) => (fairness - TRADE_FAIRNESS_THRESHOLDS.fair) /
  (TRADE_FAIRNESS_THRESHOLDS.never - TRADE_FAIRNESS_THRESHOLDS.fair);

/**
 * Seconds until an NPC buyer fills an own offer, or null when none will. Deterministic per island seed and
 * offer id: generous offers fill in 30–120 s (faster the more generous), fair ones in 2–5 min, greedy ones
 * only on a roll that shrinks to nothing at 1.5× fair value and after up to an hour; beyond that never.
 */
export const npcBuyerDelay = (seed: number, offerId: string, give: TradeLot, want: TradeLot): number | null => {
  const fairness = offerFairness(give, want);
  const random = createRandom(deriveSeed(seed, `trade-buyer-${offerId}`));
  const roll = random();
  const { fair, generous, greedyMax } = TRADE_NPC_BUYER_DELAY_SECONDS;
  switch (fairnessZone(fairness)) {
  case "generous":
    return Math.round(lerp(generous.min, generous.max, roll * fairness / TRADE_FAIRNESS_THRESHOLDS.generous));
  case "fair":
    return Math.round(lerp(fair.min, fair.max, roll));
  case "greedy": {
    const greed = greedShare(fairness);
    if (random() < greed) return null;
    return Math.round(lerp(fair.max, greedyMax, greed) + roll * fair.min);
  }
  default:
    return null;
  }
};

/** Game second the offer fills (placement time + delay), or null. */
export const npcBuyerFillAt = (seed: number, offerId: string, placedAt: number, give: TradeLot, want: TradeLot) => {
  const delay = npcBuyerDelay(seed, offerId, give, want);
  return delay === null ? null : placedAt + delay;
};
