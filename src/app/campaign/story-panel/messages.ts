import { msg } from "@lingui/core/macro";

export const STORY_PANEL_MESSAGES = {
  actions: {
    begin: msg({ id: "campaign.story.begin", message: "Begin" }),
    continue: msg({ id: "campaign.story.continue", message: "Continue" }),
    later: msg({ id: "campaign.story.later", message: "Later" }),
    next: msg({ id: "campaign.story.next", message: "Next" }),
    retry: msg({ id: "campaign.story.retry", message: "Retry" }),
    skip: msg({ id: "campaign.cinematic.skip", message: "Skip" })
  },
  captions: {
    defeat: msg({ id: "campaign.story.caption.defeat", message: "Epilogue · Defeat" }),
    intro: msg({ id: "campaignEditor.sections.story", message: "Story" }),
    victory: msg({ id: "campaign.story.caption.victory", message: "Epilogue · Victory" })
  },
  claim: {
    failed: msg({
      id: "campaign.story.claim.failed",
      message: "The reward could not be claimed yet. It is kept safe for you; try again."
    }),
    granted: msg({ id: "campaign.story.claim.granted", message: "Reward granted" }),
    pending: msg({ id: "campaign.story.claim.pending", message: "Claiming the reward…" })
  }
};
