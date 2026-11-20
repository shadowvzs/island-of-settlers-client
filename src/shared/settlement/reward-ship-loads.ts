import { TROOP_DECK_SLOTS } from "../balance/colonies";
import { colonyDeckItems, packColonyLoads } from "./colony-expedition-rules";
import type { EmigratedTroop } from "./settlement-military";
import type { Goods } from "./settlement-types";

/** One reward ship's load: the goods in its hold and the soldiers on its deck. */
export interface RewardShipLoad {
  cargo: Goods;
  troops: EmigratedTroop[];
}

/**
 * Splits what sails home into reward-ship loads of one deck each (C12, plan item 35): the soldiers first, then the
 * goods in boxes, with the same deck rule as a colony shipment (one ship per full deck).
 */
export const rewardShipLoads = (goods: Readonly<Goods>, troops: readonly EmigratedTroop[]): RewardShipLoad[] => {
  const passengers = troops.map((troop, index) => ({ slots: TROOP_DECK_SLOTS[troop.type], uid: index }));
  return packColonyLoads(colonyDeckItems(passengers, goods)).map(load => ({
    cargo: load.cargo,
    troops: load.passengers.map(index => ({ ...troops[index]! }))
  }));
};
