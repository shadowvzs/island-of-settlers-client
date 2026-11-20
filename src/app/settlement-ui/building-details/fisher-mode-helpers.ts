import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import type {
  FisherBoatBlock, FisherBoatPlace, FisherBoatStatus, FisherMode
} from "../../../shared/settlement/settlement-fisher-boat-mode";
import { getWareIconSource } from "../inventory";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { getSelectedModeDescription, type ModeChoiceView } from "./production-mode-helpers";

const blockMessage = (block: FisherBoatBlock) =>
  block === "noBoat" ? M.details.production.fisherBoatNoBoat : M.details.production.fisherBoatNoShore;

const placeMessage = (place: FisherBoatPlace) => ({
  afloat: M.details.production.fisherBoatAfloat,
  carried: M.details.production.fisherBoatCarried,
  dropped: M.details.production.fisherBoatDropped,
  incoming: M.details.production.fisherBoatIncoming,
  shore: M.details.production.fisherBoatShore,
  waiting: M.details.production.fisherBoatWaiting,
  yard: M.details.production.fisherBoatYard
})[place];

const fisherChoice = (
  mode: FisherMode, status: FisherBoatStatus, label: string, description: string, i18n?: I18n
): ModeChoiceView<FisherMode> => ({
  ariaLabel: translateMessage(i18n, M.details.production.fishWith, { name: label.toLowerCase() }),
  description,
  iconSource: getWareIconSource(mode === "rod" ? "fishingRod" : "boat"),
  label,
  pressed: status.mode === mode,
  value: mode
});

const blockReason = (status: FisherBoatStatus, i18n?: I18n) =>
  status.block && translateMessage(i18n, blockMessage(status.block));

/** The Fishery's rod/boat toggle: the boat choice is unavailable with its reason as tooltip and note. */
export const getFisherModeView = (status: FisherBoatStatus, i18n?: I18n) => {
  const reason = blockReason(status, i18n);
  const boat = fisherChoice("boat", status, translateMessage(i18n, M.details.production.fisherBoat),
    reason ?? translateMessage(i18n, M.details.production.fisherBoatHelp), i18n);
  if (reason) boat.disabled = true;
  const choices = [
    fisherChoice("rod", status, translateMessage(i18n, M.details.production.fisherRod),
      translateMessage(i18n, M.details.production.fisherRodHelp), i18n),
    boat
  ];
  return {
    blockReason: reason,
    choices,
    description: getSelectedModeDescription(choices),
    heading: translateMessage(i18n, M.details.production.fisherMethod),
    place: status.place && translateMessage(i18n, placeMessage(status.place))
  };
};

export type FisherModeView = ReturnType<typeof getFisherModeView>;
