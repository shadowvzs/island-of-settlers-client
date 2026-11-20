import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { createLazyReactContent } from "../../components/lazy-react-content";
import { type DevelopmentGroup, type DevelopmentSection, type DevelopmentTool, getToolGrid,
  mergeDevelopmentGroups } from "./helpers";
import { DEVELOPMENT_MESSAGES as M, type DevelopmentText } from "./messages";

/** A development tab's label, its tool grid and control sections. */
export interface DevelopmentTabContent {
  id: string;
  label: DevelopmentText;
  sections: readonly DevelopmentSection[];
  /** The tool grid; absent when the tab has only control sections. */
  tools?: readonly DevelopmentTool[];
}

/**
 * Development tools panel content: the React tabs, tools and sections mount on the first `mount` (panel open),
 * so React stays out of startup.
 */
export const createDevelopmentTabs = (groups: readonly DevelopmentGroup[], i18n?: I18n) => {
  const tabs: DevelopmentTabContent[] = mergeDevelopmentGroups(groups).map(({ buttons, id, label, sections }) =>
    ({ id, label, sections, tools: getToolGrid(buttons) }));
  const content = document.createElement("div");
  const lazyContent = createLazyReactContent(content, translateMessage(i18n, M.panel.title), async () =>
    (await import("./mount-development-tabs")).createDevelopmentTabsMount(tabs));
  return { content, dispose: lazyContent.dispose, mount: lazyContent.mount };
};
