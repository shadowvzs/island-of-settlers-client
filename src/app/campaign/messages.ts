import { msg } from "@lingui/core/macro";

/** Strings shared by the campaign story panel and the cinematic speaker panel. */
export const CAMPAIGN_UI_MESSAGES = {
  page: msg({ id: "campaign.ui.page", message: "{page} / {count}" }),
  pageLabel: msg({ id: "campaign.ui.pageLabel", message: "Page {page} of {count}" })
};
