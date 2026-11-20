import {
  TRADE_FAIRNESS_THRESHOLDS, TRADE_NPC_BID_FACTOR, TRADE_PROTECTED_FLOORS, TRADE_WARE_VALUES
} from "@shared/catalog/balance";

import { isForeignDrinkWare } from "../settlement/nation-drinks";
import type { TradeLot } from "./trade-types";

/** Every ware the market deals in, in table order. */
export const TRADABLE_WARES: readonly string[] = Object.keys(TRADE_WARE_VALUES);

export const isTradableWare = (ware: unknown): ware is string =>
  typeof ware === "string" && Object.hasOwn(TRADE_WARE_VALUES, ware);

/** Tradable on an island of `nation` (its own drink chain only; foreign drinks become its own on load). */
export const isNationTradable = (ware: unknown, nation: string): ware is string =>
  isTradableWare(ware) && !isForeignDrinkWare(ware, nation);

/** Value units of one unit of the ware (0 for wares the market does not take). */
export const wareValue = (ware: string) => TRADE_WARE_VALUES[ware] ?? 0;

export const lotValue = (lot: TradeLot) => wareValue(lot.ware) * lot.amount;

/** A whole, positive amount of a tradable ware. */
export const isTradeLot = (value: unknown, maxAmount = Number.MAX_SAFE_INTEGER): value is TradeLot => {
  const lot = value as TradeLot | null;
  return typeof lot === "object" && lot !== null && isTradableWare(lot.ware) &&
    Number.isSafeInteger(lot.amount) && lot.amount >= 1 && lot.amount <= maxAmount;
};

/**
 * Fairness of an own offer: value asked / fair value of what is given (NPC buyers bid
 * TRADE_NPC_BID_FACTOR of the value). Linear in both amounts, so splitting or recombining lots never
 * changes it.
 */
export const offerFairness = (give: TradeLot, want: TradeLot) =>
  lotValue(want) / (lotValue(give) * TRADE_NPC_BID_FACTOR);

export type TradeFairnessZone = "fair" | "generous" | "greedy" | "never";
export const fairnessZone = (fairness: number): TradeFairnessZone => {
  if (fairness < TRADE_FAIRNESS_THRESHOLDS.generous) return "generous";
  if (fairness <= TRADE_FAIRNESS_THRESHOLDS.fair) return "fair";
  if (fairness <= TRADE_FAIRNESS_THRESHOLDS.never) return "greedy";
  return "never";
};

/** The place-offer panel's estimate: merchants will likely accept / accept slowly / unlikely. */
export type TradeEstimate = "likely" | "slowly" | "unlikely";
export const offerEstimate = (give: TradeLot, want: TradeLot): TradeEstimate => {
  const zone = fairnessZone(offerFairness(give, want));
  if (zone === "generous" || zone === "fair") return "likely";
  return zone === "greedy" ? "slowly" : "unlikely";
};

/** Merchant offer ratio from the player's side: value paid / value received. */
export const merchantAsk = (give: TradeLot, want: TradeLot) => lotValue(want) / lotValue(give);

/** Stock trading never pays below: the player's floor, else the default. */
export const protectedFloor = (floors: Readonly<Record<string, number>>, ware: string) =>
  floors[ware] ?? TRADE_PROTECTED_FLOORS[ware] ?? 0;
