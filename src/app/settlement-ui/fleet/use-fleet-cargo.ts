import { useLingui } from "@lingui/react";
import { type FormEvent, useState } from "react";

import { useCommandStatus } from "../../components/use-command-status";
import type { SettlementUiOptions } from "../types";
import {
  type FleetSlice, getCargoRequest, getCargoWares, getFleetText, getHarbourOptions, resolveChoice
} from "./helpers";

/** Cargo form drafts; the authoritative naval simulation reserves the cargo, never this form. */
export const useFleetCargo = (slice: FleetSlice, options: Pick<SettlementUiOptions, "onQueueTransport">) => {
  const { i18n } = useLingui();
  const text = getFleetText(i18n);
  const [chosenSource, setSource] = useState<string | null>(null);
  const [chosenDestination, setDestination] = useState<string | null>(null);
  const [chosenWare, setWare] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("1");
  const { report, status } = useCommandStatus(text.cargoQueued, "cargo");
  const harbours = getHarbourOptions(slice.buildings, "Harbor", i18n);
  const wares = getCargoWares(slice.resources);
  const source = resolveChoice(harbours, chosenSource, 0);
  const destination = resolveChoice(harbours, chosenDestination, 1);
  const ware = resolveChoice(wares, chosenWare, 0);
  return {
    destination, harbours, quantity, source, status, ware, wares,
    onDestination: setDestination,
    onQuantity: setQuantity,
    onSource: setSource,
    onSubmit: (event: FormEvent) => {
      event.preventDefault();
      const request = getCargoRequest(source, destination, ware, quantity);
      if (!request) { report(text.cargoInvalid); return; }
      const result = options.onQueueTransport?.(request.source, request.destination, request.goods);
      report(result === false ? text.cargoRefused : true);
    },
    onWare: setWare
  };
};

export type FleetCargoView = ReturnType<typeof useFleetCargo>;
