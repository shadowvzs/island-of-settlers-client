import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { createLazyReactWindow } from "../../components/lazy-react-window";
import { SETTINGS_CHROME_MESSAGES as M } from "../chrome-messages";
import { LANGUAGE_MESSAGES } from "./messages";

import "./language.css";

/** Load React and Lingui only when the player opens this window. */
export const createLanguageWindow = (container: HTMLElement, i18n?: I18n) => createLazyReactWindow({
  className: "language-window", container,
  heading: () => translateMessage(i18n, M.window.language), i18n, id: "language-settings-title",
  load: async () => (await import("./language-panel")).mountLanguagePanel,
  texts: {
    error: () => translateMessage(i18n, LANGUAGE_MESSAGES.window.loadFailed),
    loading: () => translateMessage(i18n, LANGUAGE_MESSAGES.window.loading)
  }
});
