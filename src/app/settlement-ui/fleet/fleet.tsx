import { useLingui } from "@lingui/react";

import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementUiOptions } from "../types";
import type { SettlementUiStore } from "../ui-store";
import { CargoForm, PassengerControls, ShipRows } from "./fleet-view";
import { useFleet } from "./use-fleet";

interface FleetProps {
  options: SettlementUiOptions;
  store: SettlementUiStore;
  /** False while the main panel shows another view: nothing is computed then. */
  visible: boolean;
  onFocusShip?: (id: string) => void;
}
/** Main panel Ships view: cargo and passenger orders, then one row per ship (opens the ship register). */
export const Fleet = ({ options, store, visible, onFocusShip }: FleetProps) => {
  const { i18n } = useLingui();
  const { cargo, passengers, sections, ships } = useFleet(store, options, visible);
  return (
    <>
      <p className="settlement-ui__section-description">{i18n._(M.fleet.description)}</p>
      {sections.cargo && <CargoForm cargo={cargo} />}
      {sections.passengers && <PassengerControls
        passengers={passengers} shoreBlocked={sections.shoreBlocked} shores={sections.shores} />}
      <ShipRows focusable={Boolean(onFocusShip)} ships={ships} onFocusShip={id => onFocusShip?.(id)} />
      {sections.empty && <p className="settlement-ui__empty">{i18n._(M.fleet.empty)}</p>}
    </>
  );
};
