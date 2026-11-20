import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import { formatColonyDuration } from "../settlement-ui/colony-helpers";
import { SETTLEMENT_MESSAGES as M } from "../settlement-ui/messages";

type RecallShip = Pick<ReturnType<SettlementSimulation["ships"]>[number],
  "troopRecall" | "phase" | "awaySeconds" | "returningHome">;

/** Only the live colony's pickup ships; ordinary supply and reinforcement ships are excluded. */
export const troopRecallStatus = (ships: readonly RecallShip[], i18n?: I18n) => {
  const recall = ships.filter(ship => ship.troopRecall);
  if (!recall.length) return undefined;
  const incoming = recall.filter(ship => ship.phase === "away");
  if (incoming.length) return translateMessage(i18n, M.status.recallArriving, {
    time: formatColonyDuration(Math.max(...incoming.map(ship => ship.awaySeconds ?? 0)), i18n)
  });
  if (recall.some(ship => !ship.returningHome && ship.phase === "loading"))
    return translateMessage(i18n, M.status.recallBoarding);
  if (recall.every(ship => ship.returningHome)) return translateMessage(i18n, M.status.recallReturning);
  if (recall.some(ship => ship.phase === "unloading")) return translateMessage(i18n, M.status.recallWaiting);
  return translateMessage(i18n, M.status.recallSailing);
};
