import type { createNavalFleet } from "./settlement-naval-fleet";
import { tradeShipHooks } from "./settlement-naval-trade";
import { reliefDeliveryId, reliefQuestId, type ReliefShipPort } from "./settlement-relief-collections";
import { reliefShipOutsideMap } from "./settlement-relief-departure";
import type { Goods, SettlementContext } from "./settlement-types";

/** A neutral quest ship uses the existing trade visitor, berth queue, paid custody and dock porters. */
export const createReliefShipPort = (fleet: ReturnType<typeof createNavalFleet>): ReliefShipPort => ({
  find: id => fleet.saveState().ships.find(ship => ship.id === id),
  ready: id => {
    const ship = fleet.saveState().ships.find(ship => ship.id === id);
    if (ship?.visitor?.relief && ship.visitor.trade) delete ship.visitor.trade.collecting;
  },
  send: (harbourUid, questId, collecting) => {
    const queue = fleet.saveState().ships.reduce((last, ship) => Math.max(last, ship.visitor?.trade?.queue ?? 0), 0) + 1;
    const id = fleet.sendVisitor(harbourUid, {}, [], "trade", [], 0, undefined,
      { collecting: collecting ? true : undefined, delivery: reliefDeliveryId(questId), queue });
    const ship = fleet.saveState().ships.find(ship => ship.id === id);
    if (ship?.visitor) ship.visitor.relief = { version: 1, questId };
    return id;
  }
});

/** Relief identifiers are dispatched before the market hooks; ordinary trade has no changed behavior. */
export const reliefAndTradeShipHooks = (context: SettlementContext) => {
  const trade = tradeShipHooks(context);
  const questFor = (delivery: string, shipId: number) => {
    const quest = context.naval?.reliefShips?.find(shipId)?.visitor?.relief?.questId;
    return quest && reliefQuestId(delivery) === quest ? quest : undefined;
  };
  return {
    tradeUnloaded: (delivery: string, ship: number, harbour: number) => {
      const quest = questFor(delivery, ship);
      return quest === undefined ? trade.tradeUnloaded?.(delivery, ship, harbour) ?? null
        : context.relief?.collect(quest, ship, harbour) ?? null;
    },
    tradeBoxUnloaded: (delivery: string, ship: number, harbour: number, box: Goods) => {
      if (questFor(delivery, ship) === undefined) trade.tradeBoxUnloaded?.(delivery, ship, harbour, box);
    },
    tradeLoaded: (delivery: string, ship: number, cargo?: Readonly<Goods>) => {
      const quest = questFor(delivery, ship);
      if (quest === undefined) trade.tradeLoaded?.(delivery, ship);
      else if (cargo) context.relief?.loaded(quest, ship, cargo);
    },
    tradeShipGone: (delivery: string, ship: number) => {
      const quest = questFor(delivery, ship);
      if (quest === undefined) { trade.tradeShipGone?.(delivery, ship); return; }
      const visitor = context.naval?.reliefShips?.find(ship);
      if (visitor && reliefShipOutsideMap(context.options.world, visitor)) context.relief?.gone(quest, ship);
    }
  };
};
