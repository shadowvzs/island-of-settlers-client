import { msg } from "@lingui/core/macro";

/** The campaign window's start-surface frame (GS3b): a map starts from the title page without a home island. */
export const CAMPAIGN_START_MESSAGES = {
  action: msg({ id: "campaign.start.action", message: "Start map" }),
  ready: msg({ id: "campaign.start.ready", message: "Ready to start." }),
  starting: msg({ id: "campaign.start.starting", message: "Preparing the map…" })
};
