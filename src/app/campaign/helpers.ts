import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import { CAMPAIGN_UI_MESSAGES as M } from "./messages";

/** Images resolve through the owner: the campaign repository (object URLs) at runtime, fixtures in reviews. */
export type ResolveCampaignImage = (imageId: string) => string | null;

/** "2 / 3" plus its spoken form, or null for a single page. */
export const getPageLabels = (pageIndex: number, count: number, i18n?: I18n) => {
  if (count < 2) return null;
  const values = { count, page: pageIndex + 1 };
  return { label: translateMessage(i18n, M.pageLabel, values), short: translateMessage(i18n, M.page, values) };
};

export type PageLabels = ReturnType<typeof getPageLabels>;
