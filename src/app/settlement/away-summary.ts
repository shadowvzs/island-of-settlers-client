import type { I18n } from "@lingui/core";

import { describeDomainWares, translateDomainMessage } from "../../shared/i18n/domain";
import { DOMAIN_APP_MESSAGES } from "../../shared/i18n/domain-app-messages";
import { formatColonyDuration } from "../settlement-ui/colony-helpers";
import { type AwaySummary } from "./away-summary-data";

export { summarizeTimeAway, type AwaySummary } from "./away-summary-data";

const gainsText = (goods: Record<string, number>, i18n?: I18n) => {
  const gains = Object.fromEntries(Object.entries(goods).filter(([, count]) => count > 0).slice(0, 6));
  return Object.keys(gains).length ? translateDomainMessage(i18n, DOMAIN_APP_MESSAGES.offline.gains, {
    wares: describeDomainWares(gains, i18n)
  }) : "";
};

/**
 * D15 skip notice: the away gains were discarded, but calendar deadlines still advanced. Never reuse
 * the normal "While you were away" summary here: it would present discarded production as earned.
 */
const endedColonyTexts = (endedColonies: readonly string[], i18n?: I18n) => endedColonies.map(name =>
  translateDomainMessage(i18n, DOMAIN_APP_MESSAGES.offline.colonyEnded, { island: name }));

export const discardedAwayText = (awaySeconds: number, endedColonies: readonly string[], i18n?: I18n) => {
  if (!(awaySeconds > 0)) return "";
  const discarded = translateDomainMessage(i18n, DOMAIN_APP_MESSAGES.offline.discarded, {
    duration: formatColonyDuration(awaySeconds)
  });
  return [discarded, ...endedColonyTexts(endedColonies, i18n)].join(" ");
};

/**
 * Rules skip notice (offline mode, plan §10): nothing was discarded because nothing was due; only the calendar
 * deadlines that ended are worth telling.
 */
export const skippedAwayText = (endedColonies: readonly string[], i18n?: I18n) =>
  endedColonyTexts(endedColonies, i18n).join(" ");

/** One notice for the player; empty when nothing worth telling happened. */
export const awaySummaryText = (summary: AwaySummary, i18n?: I18n) => {
  const parts = [gainsText(summary.goods, i18n)];
  if (summary.experience > 0) parts.push(translateDomainMessage(i18n,
    DOMAIN_APP_MESSAGES.offline.experience, { experience: summary.experience }));
  for (const name of summary.endedColonies) parts.push(translateDomainMessage(i18n,
    DOMAIN_APP_MESSAGES.offline.colonyEnded, { island: name }));
  if (summary.capped) parts.push(translateDomainMessage(i18n, DOMAIN_APP_MESSAGES.offline.capped));
  const told = parts.filter(Boolean);
  if (!told.length) return "";
  return translateDomainMessage(i18n, DOMAIN_APP_MESSAGES.offline.summary, {
    duration: formatColonyDuration(summary.awaySeconds), parts: told.join(" ")
  });
};
