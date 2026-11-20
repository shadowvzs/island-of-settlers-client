import type { I18n } from "@lingui/core";

import { resolveTranslatableText } from "../../../../../island-of-settlers-shared/src/campaign/campaign-text";
import { translateMessage } from "../../../shared/i18n/translate";
import { joinClassNames } from "../../components/helpers";
import { progressionIcon } from "../../settlement-ui/player-hud-helpers";
import { campaignRewardEntries } from "../../settlement-ui/reward-icons/entries";
import { getRewardIconsView } from "../../settlement-ui/reward-icons/helpers";
import { getPageLabels, type ResolveCampaignImage } from "../helpers";
import { STORY_PRIMARY_ACTIONS } from "./constants";
import { STORY_PANEL_MESSAGES as M } from "./messages";
import type { StoryActionId, StoryActionResult, StoryClaim, StoryPanelContent } from "./types";

export interface StoryAction {
  className: string;
  disabled: boolean;
  id: StoryActionId;
  label: string;
}

const isLastPage = (content: StoryPanelContent, pageIndex: number) => pageIndex >= content.pages.length - 1;

/** Story text keeps the author's line breaks as paragraphs; blank lines are dropped. */
export const toParagraphs = (text: string) => text.split(/\n+/u).map(line => line.trim()).filter(Boolean);

const getCaption = (content: StoryPanelContent, i18n?: I18n) => {
  if (content.kind === "intro") return translateMessage(i18n, M.captions.intro);
  return translateMessage(i18n, content.outcome === "defeat" ? M.captions.defeat : M.captions.victory);
};

const getTone = (content: StoryPanelContent) => {
  if (content.kind === "intro") return "story";
  return content.outcome ?? "victory";
};

const getClaimMessage = (claim: StoryClaim, i18n?: I18n) => {
  if (claim.status === "pending") return translateMessage(i18n, M.claim.pending);
  if (claim.status === "failed") return translateMessage(i18n, M.claim.failed);
  return translateMessage(i18n, M.claim.granted);
};

/** The claim strip of the epilogue's last page; the rewards are those the claim actually granted. */
export const getClaimView = (claim: StoryClaim, i18n?: I18n) => {
  const entries = claim.status === "granted" ? campaignRewardEntries(claim.rewards) : [];
  const rewards = getRewardIconsView(entries, { i18n });
  return {
    label: rewards.label,
    message: getClaimMessage(claim, i18n),
    rewards: rewards.hasRewards ? rewards : null,
    status: claim.status
  };
};

export type StoryClaimView = ReturnType<typeof getClaimView>;

const lastPageActions = (content: StoryPanelContent): { id: StoryActionId; disabled?: boolean }[] => {
  if (content.kind === "intro") return [{ id: "begin" }];
  if (content.claim?.status === "failed") return [{ id: "retry" }, { id: "later" }];
  return [{ disabled: content.claim?.status === "pending", id: "continue" }];
};

const toAction = ({ disabled = false, id }: { disabled?: boolean; id: StoryActionId }, i18n?: I18n) => ({
  className: joinClassNames("settlement-ui__button settlement-popup__text-button",
    STORY_PRIMARY_ACTIONS.has(id) && "settlement-ui__button--primary"),
  disabled,
  id,
  label: translateMessage(i18n, M.actions[id])
});

/**
 * Actions of a page, primary first (the popup focuses its first action; the stylesheet shows it rightmost). Skip
 * appears only on replays and before the last page.
 */
export const getStoryActions = (content: StoryPanelContent, pageIndex: number, i18n?: I18n): StoryAction[] => {
  if (isLastPage(content, pageIndex)) return lastPageActions(content).map(action => toAction(action, i18n));
  const actions: { id: StoryActionId }[] = content.replay ? [{ id: "next" }, { id: "skip" }] : [{ id: "next" }];
  return actions.map(action => toAction(action, i18n));
};

/**
 * Skip leaves the story (owner decision 2026-11-13, kept as built): an intro closes; an epilogue never closes on
 * Skip but jumps to its last page, so the claim result (rewards, pending or retry) stays visible and the player
 * leaves through that page's own action.
 */
export const getStoryActionResult = (
  action: StoryActionId, content: StoryPanelContent, pageIndex: number
): StoryActionResult => {
  const lastIndex = Math.max(0, content.pages.length - 1);
  if (action === "next") return { index: Math.min(lastIndex, pageIndex + 1), kind: "page" };
  if (action === "retry") return { kind: "retry" };
  if (action === "skip" && content.kind === "epilogue") return { index: lastIndex, kind: "page" };
  return { kind: "close" };
};

interface StoryPanelViewOptions {
  content: StoryPanelContent;
  i18n?: I18n;
  language: string;
  pageIndex: number;
  resolveImage: ResolveCampaignImage;
}
/** Everything the story card renders for one page, in the displayed language (English fallback). */
export const getStoryPanelView = ({ content, i18n, language, pageIndex, resolveImage }: StoryPanelViewOptions) => {
  const index = Math.min(Math.max(0, pageIndex), Math.max(0, content.pages.length - 1));
  const page = content.pages[index];
  const showClaim = content.kind === "epilogue" && isLastPage(content, index) && content.claim;
  return {
    actions: getStoryActions(content, index, i18n),
    caption: getCaption(content, i18n),
    claim: showClaim ? getClaimView(showClaim, i18n) : null,
    focusKey: `${index}:${content.claim?.status ?? ""}`,
    hasImage: Boolean(page?.imageId),
    imageFallback: progressionIcon("quest-scroll"),
    imageSource: page?.imageId ? resolveImage(page.imageId) : null,
    page: getPageLabels(index, content.pages.length, i18n),
    paragraphs: page ? toParagraphs(resolveTranslatableText(page.text, language)) : [],
    pageKey: String(index),
    title: page ? resolveTranslatableText(page.title, language) : "",
    tone: getTone(content)
  };
};

export type StoryPanelView = ReturnType<typeof getStoryPanelView>;
