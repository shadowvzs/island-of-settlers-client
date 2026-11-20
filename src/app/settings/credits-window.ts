import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import { createLazyReactWindow } from "../components/lazy-react-window";
import { SETTINGS_CHROME_MESSAGES as M } from "./chrome-messages";
import { CREDITS_MESSAGES } from "./credits/messages";

import "./credits-window.css";

/**
 * Credits window (creator, third-party assets with their licences, tools), in the settlement
 * window style on its own layer; opened from the Main selection. React content loads on first open.
 */
export const createCreditsWindow = (container: HTMLElement, i18n?: I18n) => createLazyReactWindow({
  className: "credits-window", container, contentClassName: "credits-window__body",
  heading: () => translateMessage(i18n, M.window.credits), i18n, id: "settings-credits-title",
  layerClassName: "credits-window-layer", load: async () => (await import("./credits/credits-panel")).mountCreditsPanel,
  resetScrollOnOpen: true,
  texts: {
    error: () => translateMessage(i18n, CREDITS_MESSAGES.window.loadFailed),
    loading: () => translateMessage(i18n, CREDITS_MESSAGES.window.loading)
  }
});
