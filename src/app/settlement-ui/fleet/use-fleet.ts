import { useLingui } from "@lingui/react";
import { useMemo } from "react";

import { isShallowEqual } from "../../components/ui-store";
import { useStoreSelector } from "../../components/use-store-selector";
import type { SettlementUiOptions } from "../types";
import type { SettlementUiStore } from "../ui-store";
import { getFleetSections, getShipRows, selectFleet } from "./helpers";
import { useFleetCargo } from "./use-fleet-cargo";
import { useNavalPassengers } from "./use-naval-passengers";

/** The Ships view: which sections show, their form drafts, and the fleet rows (computed while shown). */
export const useFleet = (store: SettlementUiStore, options: SettlementUiOptions, visible: boolean) => {
  const { i18n } = useLingui();
  const slice = useStoreSelector(store, selectFleet, isShallowEqual, visible, i18n.locale);
  return {
    cargo: useFleetCargo(slice, options),
    passengers: useNavalPassengers(slice, options),
    sections: getFleetSections(slice, options, i18n),
    ships: useMemo(() => getShipRows(slice.ships, i18n), [i18n, slice.ships])
  };
};
