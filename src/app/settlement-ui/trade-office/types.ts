import type {
  SettlementTradeSave, TradeCheck, TradeDeliveryStatus, TradeLot
} from "../../../shared/trade/trade-types";
import type { TradeEstimate } from "../../../shared/trade/trade-values";

/**
 * The trade office as the settlement UI sees it: synchronous queries and commands of the active island's
 * simulation (each command re-validates and returns `true` or the reason). Trading is for the home island
 * only (owner rule 2026-10-19): the window is offered on the home island's harbour. Delivery stages are
 * optional; the debug "NPC traders" toggle is read from the snapshot.
 */
export interface SettlementTradeOffice {
  /** Account-wide limit of active own offers. */
  offerLimit: number;
  buy: (offerId: string) => TradeCheck;
  cancelOffer: (offerId: string) => TradeCheck;
  checkBuy: (offerId: string) => TradeCheck;
  checkPlace: (give: TradeLot, want: TradeLot) => TradeCheck;
  /** Why each pending delivery is not shipped yet, or its ship's progress. */
  deliveryStatus?: () => readonly TradeDeliveryStatus[];
  estimate: (give: TradeLot, want: TradeLot) => TradeEstimate;
  freeCapacity: (ware: string) => number;
  freeStock: (ware: string) => number;
  placeOffer: (give: TradeLot, want: TradeLot) => TradeCheck;
  /** The active island's trade state: merchant offers, own offers, deliveries, history. */
  snapshot: () => Readonly<SettlementTradeSave>;
  /** The island stores at least its storage limit of the ware (stock alone); else free capacity ≤ 0. */
  storageFull?: (ware: string) => boolean;
}
