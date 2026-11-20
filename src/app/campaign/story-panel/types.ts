import type { CampaignRewards } from "../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import type { TranslatableText } from "../../../../../island-of-settlers-shared/src/campaign/campaign-text";

/** One page of a story message: title, text and an optional story image (campaign image record id). */
export interface StoryPage {
  imageId: string | null;
  text: TranslatableText;
  title: TranslatableText;
}

/**
 * The reward claim behind the epilogue (plan item 28/34): the strip shows the claim result, never a forecast, so
 * the panel cannot disagree with what arrives home. A failed claim keeps the run "won, unclaimed".
 */
export type StoryClaim =
  | { status: "pending" }
  | { rewards: CampaignRewards; status: "granted" }
  | { status: "failed" };

export type StoryPanelKind = "intro" | "epilogue";
export type StoryOutcome = "victory" | "defeat";

/** What the story panel presents: an intro on the first entry, an epilogue at the end of the map. */
export interface StoryPanelContent {
  /** Epilogue only: the reward claim result shown on the last page. */
  claim?: StoryClaim;
  kind: StoryPanelKind;
  /** Epilogue only; tints the title like the settlement result popups. */
  outcome?: StoryOutcome;
  pages: readonly StoryPage[];
  /** A replayed map: the story can be skipped. */
  replay: boolean;
}

export type StoryActionId = "begin" | "continue" | "later" | "next" | "retry" | "skip";

/** What an action leads to: another page, closing the panel, or retrying the claim. */
export type StoryActionResult = { kind: "close" } | { index: number; kind: "page" } | { kind: "retry" };
