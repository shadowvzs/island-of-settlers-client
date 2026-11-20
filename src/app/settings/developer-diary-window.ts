import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import { createLazyReactWindow } from "../components/lazy-react-window";
import { SETTINGS_CHROME_MESSAGES as M } from "./chrome-messages";
import { DEVELOPER_DIARY_MESSAGES } from "./developer-diary/messages";

import "./developer-diary.css";

/** A quiet, manually maintained journal: no network requests and no popups on startup. */
export const createDeveloperDiary = (container: HTMLElement, i18n?: I18n) => createLazyReactWindow({
  className: "developer-diary", container, contentClassName: "developer-diary__body",
  heading: () => translateMessage(i18n, M.window.gameNews), i18n, id: "developer-diary-title",
  load: async () => (await import("./developer-diary/developer-diary-panel")).mountDeveloperDiaryPanel,
  resetScrollOnOpen: true,
  texts: {
    error: () => translateMessage(i18n, DEVELOPER_DIARY_MESSAGES.window.loadFailed),
    loading: () => translateMessage(i18n, DEVELOPER_DIARY_MESSAGES.window.loading)
  }
});
