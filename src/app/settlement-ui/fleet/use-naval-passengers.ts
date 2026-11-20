import { useLingui } from "@lingui/react";
import { useState } from "react";

import { translateMessage } from "../../../shared/i18n/translate";
import { useCommandStatus } from "../../components/use-command-status";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { ShoreTarget } from "../shore-target";
import type { SettlementUiOptions } from "../types";
import {
  type FleetSlice, getCancelOrderLabel, getFleetText, getHarbourOptions, getShoreOptions, resolveChoice
} from "./helpers";

type PassengerOptions = Pick<SettlementUiOptions,
  "onCancelSeaTransport" | "onExpeditionTargets" | "onQueueExpedition" | "onQueuePassengers">;

/**
 * Passenger voyages, sea order cancels and new-harbour shores. Requests are checked and paid by the
 * simulation; the panel never changes inventories or population.
 */
export const useNavalPassengers = (slice: FleetSlice, options: PassengerOptions) => {
  const { i18n } = useLingui();
  const text = getFleetText(i18n);
  const [chosenSource, setChosenSource] = useState<string | null>(null);
  const [chosenDestination, setDestination] = useState<string | null>(null);
  const [settlers, setSettlers] = useState("1");
  const [soldiers, setSoldiers] = useState("0");
  const [targets, setTargets] = useState<readonly ShoreTarget[]>([]);
  const [shore, setShore] = useState("0");
  const { report, status } = useCommandStatus(text.passengersQueued, "passengers");
  const harbours = getHarbourOptions(slice.buildings, "Harbour", i18n);
  const source = resolveChoice(harbours, chosenSource, 0);
  const destination = resolveChoice(harbours, chosenDestination, 1);
  return {
    destination, harbours, settlers, shore, shores: getShoreOptions(targets, i18n), soldiers, source, status,
    orders: (slice.seaOrders ?? []).map(order => ({ id: order.id, label: getCancelOrderLabel(order, i18n) })),
    onCancelOrder: (id: number) => report(options.onCancelSeaTransport?.(id)
      ? text.voyageCancelled : text.voyageDone),
    onDestination: setDestination,
    onFindShores: () => {
      const found = options.onExpeditionTargets?.(Number(source)) ?? [];
      setTargets(found);
      setShore("0");
      report(found.length ? text.shoreCost : translateMessage(i18n, M.details.harbour.noShore));
    },
    onFound: () => {
      const target = targets[Number(shore)];
      if (!target) { report(text.shoreMissing); return; }
      report(options.onQueueExpedition?.(Number(source), target) === false
        ? text.expeditionRefused : text.expeditionQueued);
    },
    onSend: () => {
      const result = options.onQueuePassengers?.(
        Number(source), Number(destination), Number(settlers), Number(soldiers));
      report(result === false ? text.passengersRefused : true);
    },
    onSettlers: setSettlers,
    onShore: setShore,
    onSoldiers: setSoldiers,
    // A new departure harbour forgets the shores found for the previous one.
    onSource: (value: string) => { setChosenSource(value); setTargets([]); }
  };
};

export type NavalPassengersView = ReturnType<typeof useNavalPassengers>;
