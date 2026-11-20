import type { ScriptValue } from "../../../../island-of-settlers-shared/src/script/types/values";
import type { Goods, SettlementContext } from "../settlement/settlement-types";
import type { TradeDeliveryRequest, TradeLot } from "../trade/trade-types";
import { describeBuildingUid } from "./script-actors";
import { listening } from "./script-unit-events";

/**
 * Trade emission sites (EXT-EVENTS, design §5.1.7): a merchant offer bought (the recorded `tradeBuy` command), an
 * own offer sold to an NPC buyer (trade clock) and the wares a trade ship unloads at the harbour. Trading exists
 * only on the home island, whose owner is the trading player. Same contract as the other helpers: the bit test
 * comes first, so nothing is built without a listener (and nothing at all in catch-up).
 */

/** The home island's owner: the player the event `player` filter tests. */
const TRADING_PLAYER = 0;

const amountOf = (value: number): ScriptValue => ({ type: "number", value });
const wareOf = (value: string): ScriptValue => ({ type: "string", value });

/** Both sides of a struck deal: `give` is what the offer's maker hands over, `want` what it asks for. */
type TradeDeal = Readonly<{ give: TradeLot; want: TradeLot }>;

const emitDeal = (context: SettlementContext, kind: "wareBought" | "wareSold", traded: TradeLot, payment: TradeLot) => {
  const script = listening(context, kind);
  if (!script) return;
  script.emit({
    kind, player: TRADING_PLAYER, responses: { amount: amountOf(traded.amount), ware: wareOf(traded.ware) },
    values: { payment: payment.ware, ware: traded.ware }
  });
};

/** The player took a merchant's offer: `ware` = the bought ware (the merchant's `give`), paid with `want`. */
export const emitWareBought = (context: SettlementContext, offer: TradeDeal) =>
  emitDeal(context, "wareBought", offer.give, offer.want);

/** An NPC buyer took the player's own offer: `ware` = the sold ware (the offer's `give`), paid with `want`. */
export const emitWareSold = (context: SettlementContext, offer: TradeDeal) =>
  emitDeal(context, "wareSold", offer.give, offer.want);

/**
 * A trade ship's wares entered harbour `harbourUid`: one event per ware with the unloaded amount. A ship brings
 * its whole delivery in one unload; a delivery finished by a later ship fires again with that ship's amount.
 */
export const emitTradeDeliveryArrived = (
  context: SettlementContext, harbourUid: number, trade: TradeDeliveryRequest["kind"], goods: Readonly<Goods>
) => {
  const script = listening(context, "tradeDeliveryArrived");
  if (!script) return;
  const harbour = describeBuildingUid(context, harbourUid);
  for (const [ware, amount] of Object.entries(goods)) {
    if (amount <= 0) continue;
    script.emit({
      ...(harbour ? { actors: { harbour } } : {}), kind: "tradeDeliveryArrived",
      player: harbour?.owner ?? TRADING_PLAYER,
      responses: { amount: amountOf(amount), ware: wareOf(ware), ...(harbour ? { building: harbour.handle } : {}) },
      values: { trade, ware }
    });
  }
};
