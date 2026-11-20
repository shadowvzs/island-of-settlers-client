import type { SettlementSimulation } from "../../../shared/settlement/settlement-simulation";
import type { ShipTroopAction, ShipTroopPort } from "../../settlement-ui/ship-register/troop-types";
import type { IslandTravel } from "../island-settlement";
import { shipTroopPanelState } from "./helpers";
import type { ShipTroopOrders } from "./ship-troop-orders";

type ShipControls = Pick<ShipTroopOrders, "armed" | "select" | "selected"> & {
  arm: (shipId: string, mode: "sail" | "unload") => void;
  cancel: () => void;
};

interface ShipTroopPortOptions {
  canCommand: () => boolean;
  getIslandTravel?: () => IslandTravel | undefined;
  /** The military controls' ship orders (created after the settlement UI, so read lazily). */
  ships: () => ShipControls | undefined;
  simulation: Pick<SettlementSimulation, "troopShipActions" | "troopShipStatus">;
}

/**
 * The campaign's "Return home" ends the run: offered once its map is decided, never as a one-click give-up of a
 * running map (the conservative reading of "only when the run allows it", §9.3).
 */
const campaignReturnAllowed = (travel: IslandTravel | undefined) => {
  const run = travel?.campaignRun?.();
  return run !== undefined && run.status !== "running";
};

/**
 * The ship window's troop port: the panel from `troopShipActions` / `troopShipStatus`, its target modes through
 * the military controls (one owner of the map cursor and clicks) and "Return home" through the existing paths,
 * the colony recall (`recallSoldiers`) or the campaign run's end (`endCampaignRun`).
 */
export const createShipTroopPort = (options: ShipTroopPortOptions): ShipTroopPort => {
  const { simulation } = options;
  const returnHome = (shipId: string) => {
    const travel = options.getIslandTravel?.();
    const kind = simulation.troopShipActions(Number(shipId))?.returnHome;
    if (kind === "colonyRecall") {
      const island = travel?.active();
      if (island != null) travel?.recallSoldiers?.(island);
      return;
    }
    if (kind === "campaignRun" && campaignReturnAllowed(travel)) void travel?.endCampaignRun?.();
  };
  /** A panel mode button toggles: pressed again, it ends the armed mode. */
  const toggleMode = (shipId: string, mode: "sail" | "unload") => {
    const ships = options.ships();
    if (ships?.armed() === mode && ships.selected() === Number(shipId)) ships.cancel();
    else ships?.arm(shipId, mode);
  };
  return {
    panel: shipId => {
      const id = Number(shipId);
      const actions = simulation.troopShipActions(id), status = simulation.troopShipStatus(id);
      if (!actions || !status) return null;
      const ships = options.ships();
      const armed = ships?.selected() === id ? ships.armed() : null;
      return shipTroopPanelState(actions, status,
        { armed, campaignReturn: campaignReturnAllowed(options.getIslandTravel?.()) });
    },
    run: (shipId: string, action: ShipTroopAction) => {
      if (!options.canCommand()) return;
      if (action === "returnHome") returnHome(shipId);
      else toggleMode(shipId, action);
    },
    select: shipId => options.ships()?.select(shipId)
  };
};
