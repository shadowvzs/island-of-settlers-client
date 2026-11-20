import { addToHome } from "./colony-economy";
import type { NavalShip } from "./settlement-naval-fleet";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

/**
 * Reward ships (adventure loot, campaign rewards and survivors, plan item 35): their cargo is never lost. A
 * reward ship whose harbour is gone (demolished before the block below existed, or destroyed in a battle) sails to
 * another finished harbour; with none left its goods and soldiers are credited to the home building at once.
 */

export interface RewardShipOptions {
  /** The finished own harbour of `uid`, if it still stands. */
  harbor(uid: number): SettlementBuilding | undefined;
  /** The best other finished harbour for a visitor, if any. */
  bestHarbour(): number | undefined;
  context: SettlementContext;
}

/** An inbound reward ship (not leaving yet). */
export const isInboundRewardShip = (ship: NavalShip) => ship.visitor?.role === "reward" && !ship.visitor.leaving;

/** True when a reward ship is still bound for harbour `uid` (its demolition waits, plan item 35). */
export const rewardShipBoundFor = (ships: readonly NavalShip[], uid: number) =>
  ships.some(ship => isInboundRewardShip(ship) && ship.destinationUid === uid);

export const createRewardShips = ({ bestHarbour, context, harbor }: RewardShipOptions) => {
  /** The reward ship's harbour no longer stands. */
  const harbourLost = (ship: NavalShip) => isInboundRewardShip(ship) && !harbor(ship.destinationUid!);
  /** Goods into the home building, soldiers into its reserve; false when the island has no home building. */
  const creditHome = (ship: NavalShip) => {
    if (!addToHome(context.buildings, ship.cargo)) return false;
    if (ship.troops?.length) context.military?.immigrate?.(ship.troops);
    ship.cargo = {}; ship.cargoCount = 0; ship.troops = undefined;
    return true;
  };
  /**
   * A reward ship that lost its harbour: "rerouted" (bound for another harbour), "credited" (its load is at home,
   * the ship leaves empty) or "waiting" (no home building either: it keeps its load and asks again).
   */
  const recover = (ship: NavalShip): "credited" | "rerouted" | "waiting" => {
    const target = bestHarbour();
    if (target !== undefined) { ship.destinationUid = target; return "rerouted"; }
    return creditHome(ship) ? "credited" : "waiting";
  };
  return { harbourLost, recover };
};
