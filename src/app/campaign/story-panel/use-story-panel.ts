import { useLingui } from "@lingui/react";
import { useState } from "react";

import type { ResolveCampaignImage } from "../helpers";
import { getStoryActionResult, getStoryPanelView } from "./helpers";
import type { StoryActionId, StoryPanelContent } from "./types";

export interface StoryPanelOptions {
  content: StoryPanelContent;
  resolveImage: ResolveCampaignImage;
  onClose: () => void;
  onRetryClaim: () => void;
}

/**
 * Page cursor and actions of one story panel. The owner keys the panel by its content, so a new story starts on
 * its first page; the claim result arrives as new `content.claim` and updates the strip in place.
 */
export const useStoryPanel = ({ content, onClose, onRetryClaim, resolveImage }: StoryPanelOptions) => {
  const { i18n } = useLingui();
  const [pageIndex, setPageIndex] = useState(0);
  const view = getStoryPanelView({ content, i18n, language: i18n.locale, pageIndex, resolveImage });
  const onAction = (action: StoryActionId) => {
    const result = getStoryActionResult(action, content, pageIndex);
    if (result.kind === "page") return setPageIndex(result.index);
    if (result.kind === "retry") return onRetryClaim();
    onClose();
  };
  return { onAction, view };
};
