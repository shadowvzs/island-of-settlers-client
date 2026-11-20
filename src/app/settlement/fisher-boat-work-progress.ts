import type { I18n, MessageDescriptor } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import {
  FISHER_BOAT_BEACH_SECONDS, FISHER_BOAT_LAUNCH_SECONDS, FISHER_BOAT_LIFT_SECONDS, FISHER_BOAT_NET_SECONDS
} from "../../shared/settlement/constants";
import type { SettlementActor } from "../../shared/settlement/settlement-types";
import { SETTLEMENT_MESSAGES as M } from "../settlement-ui/messages";

const boatStep = (phase: string): [number, MessageDescriptor] | undefined => ({
  fisherBoatBeach: [FISHER_BOAT_BEACH_SECONDS, M.status.progressBoatBeach],
  fisherBoatLaunch: [FISHER_BOAT_LAUNCH_SECONDS, M.status.progressBoatLaunch],
  fisherBoatLift: [FISHER_BOAT_LIFT_SECONDS, M.status.progressBoatLift],
  fisherBoatNet: [FISHER_BOAT_NET_SECONDS, M.status.progressBoatNet]
} as Record<string, [number, MessageDescriptor]>)[phase];

/** The timed in-place steps of a Fishery boat trip: remaining share of the step and its label. */
export const fisherBoatWorkStep = (actor: SettlementActor, i18n?: I18n) => {
  const step = boatStep(actor.phase);
  if (!step) return undefined;
  return { duration: step[0], label: translateMessage(i18n, step[1]), remaining: actor.timer };
};
