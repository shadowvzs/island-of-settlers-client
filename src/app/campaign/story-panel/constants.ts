import type { StoryActionId } from "./types";

/** Title element of the story dialog (`aria-labelledby`). */
export const STORY_PANEL_TITLE_ID = "campaign-story-panel-title";

/** Actions drawn as the primary (filled) button; Skip and Later stay secondary. */
export const STORY_PRIMARY_ACTIONS: ReadonlySet<StoryActionId> = new Set(["begin", "continue", "next", "retry"]);
