import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementResidenceSummary } from "../types";

/** "3 min", "2 min 30 s", "45 s": settler periods are whole seconds at most. */
export const formatResidencePeriod = (seconds: number, i18n?: I18n) => {
  const total = Math.max(1, Math.round(seconds));
  const minutes = Math.floor(total / 60), rest = total % 60;
  if (!minutes) return translateMessage(i18n, M.details.residence.seconds, { seconds: rest });
  if (!rest) return translateMessage(i18n, M.details.residence.minutes, { minutes });
  return translateMessage(i18n, M.details.residence.minutesSeconds, { minutes, seconds: rest });
};

const HOME_NAMES = {
  harbour: M.details.residence.harbour,
  headquarters: M.details.residence.headquarters
} as const satisfies Readonly<Record<SettlementResidenceSummary["home"], unknown>>;

/** The residence section's two stats and its note, ready to render. */
export const getResidenceView = (residence: SettlementResidenceSummary, i18n?: I18n) => {
  const period = formatResidencePeriod(residence.growthSeconds, i18n);
  const home = translateMessage(i18n, HOME_NAMES[residence.home]);
  return {
    note: translateMessage(i18n,
      residence.talentAdjusted ? M.details.residence.noteTalent : M.details.residence.note, { home }),
    stats: [
      { label: translateMessage(i18n, M.details.residence.limit), value: `+${residence.limitBonus}` },
      { label: translateMessage(i18n, M.details.residence.extraSettler, { home }),
        value: translateMessage(i18n, M.details.residence.period, { period }) }
    ]
  };
};
