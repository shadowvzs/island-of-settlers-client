import type { I18n } from "@lingui/core";

import type { CampaignMap } from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import { resolveTranslatableText } from "../../../../island-of-settlers-shared/src/campaign/campaign-text";
import { CAMPAIGN_TEXT_FALLBACK_LOCALE } from "./constants";

/**
 * Display names of campaign records for the player (campaign window, end notice). Light on purpose: the session
 * imports it at startup, the window's heavier helpers load with the window.
 */
const localeOf = (i18n?: I18n) => i18n?.locale ?? CAMPAIGN_TEXT_FALLBACK_LOCALE;

/** A campaign or map record's display name in the active language, else its id. */
export const campaignRecordName = (record: Pick<CampaignMap, "id" | "name">, i18n?: I18n) =>
  resolveTranslatableText(record.name, localeOf(i18n)) || record.id;

/** The display name of a map's named exit; null for the implicit `victory` exit or an exit the map lost. */
export const campaignExitName = (map: Pick<CampaignMap, "exits">, exit: string, i18n?: I18n) => {
  const named = map.exits?.find(entry => entry.id === exit);
  if (!named) return null;
  return resolveTranslatableText(named.name, localeOf(i18n)) || exit;
};
