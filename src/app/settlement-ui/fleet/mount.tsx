import { createComponentMount } from "../../components/react-island";
import type { MainPanelVisibilityStore } from "../main-panel/main-panel";
import { useMainPanelView } from "../main-panel/use-main-panel-view";
import type { SettlementUiOptions } from "../types";
import type { SettlementUiStore } from "../ui-store";
import { Fleet } from "./fleet";

interface FleetSlotProps {
  options: SettlementUiOptions;
  panel: MainPanelVisibilityStore;
  store: SettlementUiStore;
  onFocusShip?: (id: string) => void;
}
const FleetSlot = ({ options, panel, store, onFocusShip }: FleetSlotProps) => (
  <Fleet options={options} store={store} visible={useMainPanelView(panel, "ships")} onFocusShip={onFocusShip} />
);

/**
 * Mounter for `createLazyReactContent` (the main panel's Ships view slot): the Fleet is live while the panel
 * shows its Ships view; `onFocusShip` opens the ship register on a row's ship.
 */
export const createFleetMount = (
  store: SettlementUiStore, options: SettlementUiOptions, panel: MainPanelVisibilityStore,
  onFocusShip?: (id: string) => void
) => createComponentMount(FleetSlot, { options, panel, store, onFocusShip });
