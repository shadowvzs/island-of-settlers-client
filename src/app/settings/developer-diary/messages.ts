import { msg } from "@lingui/core/macro";

/**
 * Game News window chrome. Entries are authored editorial copy and stay in English until an editor
 * supplies reviewed Hungarian article text.
 */
export const DEVELOPER_DIARY_MESSAGES = {
  intro: msg({
    id: "settings.news.intro",
    message: "A little journal of what’s new around the islands."
  }),
  window: {
    loadFailed: msg({
      id: "settings.news.window.loadFailed",
      message: "Game News could not load. Close and reopen to retry."
    }),
    loading: msg({ id: "settings.news.window.loading", message: "Loading Game News…" })
  }
} as const;
