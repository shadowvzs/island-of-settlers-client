import type { I18n } from "@lingui/core";

import type { CampaignNodeState } from "../../../../../island-of-settlers-shared/src/campaign/campaign-graph";
import type { CampaignRequirementStatus } from "../../../shared/campaign/campaign-requirements";
import { translateDomainText } from "../../../shared/i18n/domain";
import { translateMessage } from "../../../shared/i18n/translate";
import { CAMPAIGN_WINDOW_MESSAGES as M } from "./messages";
import { CAMPAIGN_START_MESSAGES as S } from "./start-messages";

/** Where the campaign window is shown: the home island's window, or the title page without a home (plan §7.4). */
export type CampaignWindowFrame = "home" | "start";

export interface CampaignStartModel {
  disabled: boolean;
  /** Why the map cannot start (locked, closed, level), else the ready line. */
  hint: string;
}

const isLocked = (node: CampaignNodeState) => node === "notAvailable" || node === "closed";

const startHint = (node: CampaignNodeState, status: CampaignRequirementStatus, i18n?: I18n) => {
  if (isLocked(node)) return translateMessage(i18n, M.status[node]);
  if (status.reason) return translateDomainText(status.reason, i18n);
  return translateMessage(i18n, S.ready);
};

/** The start-surface panel of the selected map: no cargo, ships or harbour; only the lock and the level gate. */
export const campaignStartModel = (
  node: CampaignNodeState, status: CampaignRequirementStatus, busy: boolean, i18n?: I18n
): CampaignStartModel => ({
  disabled: busy || isLocked(node) || status.reason !== null,
  hint: startHint(node, status, i18n)
});

/** The status line while a start-surface map is prepared, else the home window's departure line. */
export const campaignBusyText = (frame: CampaignWindowFrame, i18n?: I18n) =>
  translateMessage(i18n, frame === "start" ? S.starting : M.departing);
