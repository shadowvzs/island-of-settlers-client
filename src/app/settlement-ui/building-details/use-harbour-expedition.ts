import type { I18n } from "@lingui/core";

import { useKeyedStatus } from "../../components/use-command-status";
import type { ShoreTarget } from "../shore-target";
import type { SettlementUiOptions } from "../types";
import { getHarbourText, getScoutingView } from "./harbour-helpers";

/**
 * Harbour actions. The simulation owns crew, supplies and voyage receipts; discovered settlement
 * spots are queried here and an Occupy action starts the same expedition preparation.
 */
export const useHarbourExpedition = (uid: number, options: SettlementUiOptions, i18n?: I18n) => {
  const { setStatus, status } = useKeyedStatus(uid);
  const text = getHarbourText(i18n);
  const scouting = getScoutingView(options.onScoutingAvailability?.(uid), i18n);
  const potential = options.onPotentialSettlements?.(uid) ?? [];
  const report = (accepted: boolean | undefined, yes: string, no: string) => setStatus(accepted ? yes : no);
  return {
    exploreDisabled: scouting.disabled,
    exploreTitle: scouting.title,
    hideExplore: scouting.hidden,
    potential,
    status,
    onCancel: (id: number, yes: string, no: string) => report(options.onCancelSeaTransport?.(id), yes, no),
    onExplore: () => report(options.onQueueExploration?.(uid), text.exploreAccepted, text.exploreRefused),
    onLaunchTarget: (target: ShoreTarget) =>
      report(Boolean(options.onQueueExpedition?.(uid, target)), text.launchAccepted, text.launchRefused)
  };
};
