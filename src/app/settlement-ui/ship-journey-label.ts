import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import { joinDetails } from "../components/helpers";
import { formatColonyDuration } from "./colony-helpers";
import { SETTLEMENT_MESSAGES as M } from "./messages";
import type { SettlementShipSummary } from "./types";

export const shipJourneyLabel = (ship: SettlementShipSummary, i18n?: I18n) => {
  const route = ship.origin && ship.destination ? `${ship.origin} → ${ship.destination}` : "";
  const eta = ship.legSeconds === undefined ? "" : translateMessage(i18n, M.fleet.currentLeg, {
    time: formatColonyDuration(ship.legSeconds)
  });
  return joinDetails(route, ship.leg, eta);
};
