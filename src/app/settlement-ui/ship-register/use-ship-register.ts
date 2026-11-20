import { useLingui } from "@lingui/react";
import { useMemo } from "react";

import { type ExternalStore, useExternalStore } from "../../components/external-store";
import { getShipRegisterView, type ShipRegisterState } from "./helpers";

/** The prepared register view; the adapter publishes a new state only when it changed. */
export const useShipRegister = (store: ExternalStore<ShipRegisterState>) => {
  const { i18n } = useLingui();
  const state = useExternalStore(store);
  return useMemo(() => getShipRegisterView(state, i18n), [i18n, state]);
};
