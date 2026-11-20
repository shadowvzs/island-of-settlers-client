import type { MarketControls } from "../../shared/trade/market";
import type { StockGoods } from "../../shared/trade/stock-move";
import type { ServerMarket } from "../cloud/server-market";
import type { StockMoveApply } from "../save-store/remote-save-store";

/**
 * The settlement's view of the server Market: the server operations plus the local storage callback that
 * applies a committed deposit/withdrawal to the live home island. The callback is bound to the current
 * simulation by the island session, so the Market window never reaches into settlement state directly.
 */
export const createMarketControls = (
  market: ServerMarket, apply: StockMoveApply, saveBeforeMarketMove?: () => Promise<boolean>,
  isHome?: () => boolean
): MarketControls => {
  const saveFirst = async () => {
    if (isHome && !isHome())
      throw new Error("The Player Market moves goods on your home island only. Return home and retry.");
    if (!saveBeforeMarketMove) return;
    const saved = await saveBeforeMarketMove();
    if (!saved) throw new Error(
      "The home island could not be saved. No Market goods were moved; retry when the cloud save is current.");
  };
  return {
    accept: async (trade) => { await saveFirst(); return market.accept(trade, apply); },
    cancel: market.cancel,
    claim: async (goods: StockGoods) => { await saveFirst(); return market.claim(goods, apply); },
    discardPendingBuy: market.discardPendingBuy,
    discardPendingClaim: market.discardPendingClaim,
    discardPendingOffer: market.discardPendingOffer,
    load: market.load,
    offer: async (draft) => { await saveFirst(); return market.offer(draft, apply); },
    retryBuy: async () => { await saveFirst(); return market.retryBuy(apply); },
    retryClaim: async () => { await saveFirst(); return market.retryClaim(apply); },
    retryOffer: async () => { await saveFirst(); return market.retryOffer(apply); }
  };
};
