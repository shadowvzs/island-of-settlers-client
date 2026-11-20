import type { I18n } from "@lingui/core";
import { TRADE_MAX_ACTIVE_OFFERS } from "@shared/catalog/balance";

import { translateDomainText } from "../../shared/i18n/domain";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { TradeCheck, TradeDeliveryStatus } from "../../shared/trade/trade-types";
import type { SettlementTradeOffice } from "../settlement-ui/trade-office/types";

/** Queries the simulation may offer (delivery stages, stock-alone storage limit). */
type OptionalTradeQueries = Partial<{
  tradeDeliveryStatus: () => readonly TradeDeliveryStatus[];
  tradeStorageFull: (ware: string) => boolean;
}>;

interface TradeOfficeSessionOptions {
  /** False during a session transition: offers and purchases refuse instead of mutating the world. */
  canCommand?: () => boolean;
  /** Active Lingui instance: refusal reasons and success notices follow the shown locale. */
  i18n?: I18n;
  /** Status toast after an accepted command. */
  message: (text: string) => void;
  /** Publishes the settlement UI snapshot (stock, deliveries) right after a command. */
  updateUi: () => void;
}

/**
 * The trade office of the island on screen, on its simulation: queries pass through, commands (journalled by
 * the simulation, re-validated there) publish the UI at once and return `true` or the refusal reason.
 */
export const createTradeOfficeSession = (
  simulation: SettlementSimulation, { canCommand = () => true, i18n, message, updateUi }: TradeOfficeSessionOptions
): SettlementTradeOffice => {
  const optional = simulation as SettlementSimulation & OptionalTradeQueries;
  const localize = (value: TradeCheck) => typeof value === "string" ? translateDomainText(value, i18n) : value;
  const run = (command: () => TradeCheck, success: string) => {
    if (!canCommand()) return translateDomainText("The island is changing. Try again in a moment.", i18n);
    const result = command();
    if (result === true) message(translateDomainText(success, i18n));
    updateUi();
    return localize(result);
  };
  return {
    buy: offerId => run(() => simulation.tradeBuy(offerId), "Purchase paid: a trade ship brings the wares."),
    cancelOffer: offerId => run(() => simulation.tradeCancelOffer(offerId), "Offer cancelled: the wares return."),
    checkBuy: offerId => localize(simulation.tradeCheckBuy(offerId)),
    checkPlace: (give, want) => localize(simulation.tradeCheckPlace(give, want)),
    deliveryStatus: optional.tradeDeliveryStatus,
    estimate: simulation.tradeEstimate,
    freeCapacity: simulation.tradeFreeCapacity,
    freeStock: simulation.tradeFreeStock,
    get offerLimit() { return TRADE_MAX_ACTIVE_OFFERS + simulation.talentModifiers().tradeOfferSlots; },
    placeOffer: (give, want) => run(() => simulation.tradePlaceOffer(give, want), "Offer placed at the Market."),
    snapshot: simulation.trade,
    storageFull: optional.tradeStorageFull
  };
};
