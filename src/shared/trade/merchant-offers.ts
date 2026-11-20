import {
  isMaterialAvailable, TRADE_MARKET_DAY_SECONDS, TRADE_MERCHANT_ASK_BAND, TRADE_MERCHANT_LOT_VALUE,
  TRADE_MERCHANT_OFFER_COUNT
} from "@shared/catalog/balance";

import { isWareAllowedByTier } from
  "../../../../island-of-settlers-shared/src/game-settings/building-availability";
import { lerp } from "../world/noise";
import { createRandom, deriveSeed, pickFrom, type Random } from "../world/rng";
import type { MerchantOffer, TradeMarket } from "./trade-types";
import { isNationTradable, merchantAsk, TRADABLE_WARES, wareValue } from "./trade-values";

/** Named NPC merchants (honest NPCs, never presented as players). */
export const TRADE_MERCHANTS: readonly string[] = [
  "Aurelia Venta", "Bjorn Saltbeard", "Chiyo Hamada", "Darius Corvo", "Eshe Adebayo", "Fenna Holt",
  "Gaius Marinus", "Hakon Ironside", "Imani Okoro", "Jiro Tanabe", "Livia Portus", "Sigrid Wavecrest"
];
const OFFER_ATTEMPTS = 8;

/** Market day of a trade clock reading. */
export const marketDay = (elapsed: number) => Math.floor(Math.max(0, elapsed) / TRADE_MARKET_DAY_SECONDS);


/** One offer within the ask band, or null when rounding pushes the ask outside it. */
const draftOffer = (random: Random, wares: readonly string[]) => {
  const giveWare = pickFrom(random, wares);
  // Owner rule 2026-10-19: a merchant never asks for the ware it offers.
  const wantWare = pickFrom(random, wares.filter(ware => ware !== giveWare));
  const lotValue = lerp(TRADE_MERCHANT_LOT_VALUE.min, TRADE_MERCHANT_LOT_VALUE.max, random());
  const give = { amount: Math.max(1, Math.round(lotValue / wareValue(giveWare))), ware: giveWare };
  const ask = lerp(TRADE_MERCHANT_ASK_BAND.min, TRADE_MERCHANT_ASK_BAND.max, random());
  const want = { amount: Math.ceil(give.amount * wareValue(giveWare) * ask / wareValue(wantWare)), ware: wantWare };
  const realAsk = merchantAsk(give, want);
  return realAsk >= TRADE_MERCHANT_ASK_BAND.min && realAsk <= TRADE_MERCHANT_ASK_BAND.max ? { give, want } : null;
};

/**
 * The island's merchant offers for one market day: seeded by the island seed and the day, limited to wares
 * the player's level unlocks (`isMaterialAvailable`) and the island's nation trades, every ask inside
 * TRADE_MERCHANT_ASK_BAND. `tierCap`: the map's highest material tier (MAP BUILDING AVAILABILITY).
 */
export const generateMerchantMarket = (
  seed: number, day: number, playerLevel: number, nation = "roman", tierCap?: number
): TradeMarket => {
  const random = createRandom(deriveSeed(seed, `trade-market-${day}`));
  const wares = TRADABLE_WARES
    .filter(ware => isMaterialAvailable(ware, playerLevel) && isNationTradable(ware, nation) &&
      isWareAllowedByTier({ tier: tierCap }, ware));
  const offers: MerchantOffer[] = [];
  for (let index = 0; index < TRADE_MERCHANT_OFFER_COUNT; index++) {
    const merchant = pickFrom(random, TRADE_MERCHANTS);
    for (let attempt = 0; attempt < OFFER_ATTEMPTS; attempt++) {
      const draft = draftOffer(random, wares);
      if (!draft) continue;
      offers.push({ ...draft, id: `m${day}-${index}`, merchant, status: "open" });
      break;
    }
  }
  return { day, level: playerLevel, offers };
};
