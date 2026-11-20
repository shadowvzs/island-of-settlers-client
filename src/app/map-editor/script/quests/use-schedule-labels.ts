import { useLingui } from "@lingui/react";

import { translateMessage } from "../../../../shared/i18n/translate";
import { QUEST_MESSAGES as M } from "./messages";

/** Fixed texts of the repeat and deadline fields in the active locale. */
export const useScheduleLabels = () => {
  const { i18n } = useLingui();
  const text = (descriptor: Parameters<typeof translateMessage>[1]) => translateMessage(i18n, descriptor);
  return {
    claimDates: text(M.claimDates), claimHistory: text(M.claimHistory), dateUtc: text(M.dateUtc), day: text(M.day),
    days: text(M.days), deadline: text(M.deadline), hours: text(M.hours), maxClaims: text(M.maxClaims),
    minutes: text(M.minutes), month: text(M.month), repeat: text(M.repeat), retry: text(M.retry),
    seconds: text(M.seconds), timeUtc: text(M.timeUtc), weekday: text(M.weekday)
  };
};
