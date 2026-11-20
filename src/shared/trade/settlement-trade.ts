import { emitTradeDeliveryArrived, emitWareBought, emitWareSold } from "../script-world/script-trade-events";
import type { Goods, SettlementContext } from "../settlement/settlement-types";
import {
  buyMerchantOffer, cancelPlayerOffer, dropSameWareOffers, foldIslandTrade, placePlayerOffer, refundOffersWhileOff,
  setNpcTraders, setProtectedFloor, updateTrade
} from "./trade-commands";
import { escrowCustodyPools, repointEscrowCustody } from "./trade-custody";
import { isEscrowCollected, reconcileEscrows } from "./trade-escrow";
import { isTradeHomeIsland, settlementTradePort, tradeHarbour } from "./trade-island";
import { createTradeState, goodsCount } from "./trade-ledger";
import { migrateTradeSave } from "./trade-save";
import {
  dispatchTradeShips, reconcileTradeShips, type TradeArrivalListener, tradeShipBoxUnloaded, tradeShipGone,
  tradeShipLoaded, tradeShipUnloaded
} from "./trade-shipping";
import type {
  PlayerOffer, SettlementTradeSave, TradeDeliveryStatus, TradeLot, TradeShipPort
} from "./trade-types";
import { validateMerchantBuy, validatePlaceOffer } from "./trade-validation";
import { isTradeLot, offerEstimate } from "./trade-values";

const NO_SHIPS: TradeShipPort = { ready: () => undefined, send: () => null, shipIds: () => new Set() };

/**
 * The island's trade office inside the settlement simulation: its state is saved with the island, its
 * commands are journalled simulation commands (bug-replay.ts) and its clocks advance with the ticks, so
 * offline catch-up and replays reproduce merchant days, NPC buyers and trade ships.
 */
export const createSettlementTrade = (context: SettlementContext) => {
  let state = createTradeState();
  let statuses: TradeDeliveryStatus[] = [];
  const port = () => settlementTradePort(context, state);
  const ships = () => context.naval?.tradeShips ?? NO_SHIPS;
  const isEmpty = () => !state.escrow.length && !state.offers.length && !state.deliveries.length && !state.market &&
    !state.history.length;
  /** Off the home island: trade state from an older build is refunded into this island once, then dropped. */
  const dropOffHome = () => {
    if (isEmpty() || isTradeHomeIsland(context)) return false;
    if (foldIslandTrade(state, port())) state = createTradeState();
    statuses = [];
    return true;
  };
  /** Every 0.5 s scheduler step: escrows follow the island's harbour, trade ships sail. */
  const schedule = () => {
    if (!state.escrow.length && !state.deliveries.length) { statuses = []; return; }
    reconcileEscrows(state, context);
    statuses = dispatchTradeShips(state, tradeHarbour(context.buildings)?.uid, ships());
  };
  const restore = (saved?: SettlementTradeSave) => {
    statuses = [];
    if (!saved) { state = createTradeState(); return; }
    const migrated = migrateTradeSave(saved);
    state = migrated.state;
    if (goodsCount(migrated.credit)) port().store(migrated.credit);
    dropSameWareOffers(state, port());
    reconcileTradeShips(state, ships().shipIds());
  };
  /** A placed offer is the trade office's tutorial event; it need not be accepted. */
  const placeOffer = (give: unknown, want: unknown) => {
    const result = placePlayerOffer(state, port(), give, want);
    if (result === true) context.options.onTutorialEvent?.("trade-offer");
    return result;
  };
  /** A bought merchant offer is a script event (`wareBought`); a refused Buy is not. */
  const buy = (offerId: string) => {
    const result = buyMerchantOffer(state, port(), offerId);
    const offer = result === true && context.script ? state.market?.offers.find(entry => entry.id === offerId)
      : undefined;
    if (offer) emitWareBought(context, offer);
    return result;
  };
  /** Script listeners of the trade clock and the trade ship, created once (they test the subscription first). */
  const sold = (offer: PlayerOffer) => emitWareSold(context, offer);
  const arrived: TradeArrivalListener = (delivery, goods, harbourUid) =>
    emitTradeDeliveryArrived(context, harbourUid, delivery.kind, goods);
  return {
    buy,
    cancelOffer: (offerId: string) => cancelPlayerOffer(state, port(), offerId),
    /** Would Buy succeed now? (the market list enables its Buy button from this) */
    checkBuy: (offerId: string) => validateMerchantBuy(state, port(), offerId),
    checkPlace: (give: unknown, want: unknown) => validatePlaceOffer(state, port(), give, want),
    /** Status of each pending delivery (collecting, blocked with a reason, queued, shipping). */
    deliveryStatus: (): readonly TradeDeliveryStatus[] => statuses,
    /** Whether all of the escrow lies in the harbour's trade stock (an unknown id counts as collected). */
    escrowCollected: (escrowId: string) => {
      const escrow = state.escrow.find(entry => entry.id === escrowId);
      return !escrow || isEscrowCollected(escrow);
    },
    estimate: (give: TradeLot, want: TradeLot) =>
      isTradeLot(give) && isTradeLot(want) ? offerEstimate(give, want) : "unlikely",
    freeCapacity: (ware: string) => Math.max(0, port().freeCapacity(ware)),
    freeStock: (ware: string) => port().freeStock(ware),
    npcTraders: () => state.npcTraders,
    placeOffer,
    /** The game rules changed or were loaded (GS4a): open offers are refunded while trading is off. */
    applyRules: () => refundOffersWhileOff(state, port()),
    restore,
    /** Only the home island keeps trade state (undefined elsewhere). */
    save: (): SettlementTradeSave | undefined => isEmpty() && !isTradeHomeIsland(context) ? undefined
      : structuredClone(state),
    schedule,
    setNpcTraders: (enabled: unknown) => setNpcTraders(state, enabled),
    setProtectedFloor: (ware: unknown, amount: unknown) =>
      !port().featureOff && setProtectedFloor(state, ware, amount),
    /** Fleet hooks of the trade ship (settlement-naval-trade.ts). */
    shipBoxUnloaded: (deliveryId: string, shipId: number, harbourUid: number, box: Readonly<Goods>) =>
      tradeShipBoxUnloaded(state, port(), deliveryId, shipId, harbourUid, box, arrived),
    shipGone: (deliveryId: string, shipId: number) => tradeShipGone(state, deliveryId, shipId),
    shipLoaded: (deliveryId: string, shipId: number) => tradeShipLoaded(state, deliveryId, shipId),
    shipUnloaded: (deliveryId: string, shipId: number, harbourUid: number): Goods | null =>
      tradeShipUnloaded(state, port(), deliveryId, shipId, harbourUid, arrived),
    snapshot: (): Readonly<SettlementTradeSave> => structuredClone(state),
    /** Pools named by paid escrow custody (a bridge removal never splits them). */
    custodyPools: () => escrowCustodyPools(state.escrow),
    /** Pools merged: custody of the vanished pool moves to the survivor. */
    repointCustody: (from: number, to: number) => repointEscrowCustody(state.escrow, from, to),
    /** The island stores at least its storage limit of the ware (Buy / want refused: owner rule). */
    storageFull: (ware: string) => port().storageFull(ware),
    update: (dt: number) => { if (!dropOffHome()) updateTrade(state, port(), dt, sold); }
  };
};
export type SettlementTrade = ReturnType<typeof createSettlementTrade>;
