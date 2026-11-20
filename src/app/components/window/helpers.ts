import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import { translateMessage } from "../../../shared/i18n/translate";

/** Class of the `display: contents` element a window frame's React root renders into. */
const WINDOW_HOST_CLASS = "app-react-host";

const WINDOW_CHROME_MESSAGES = {
  close: msg({ id: "chrome.window.close", message: "Close {name} window" }),
  move: msg({ id: "chrome.window.move", message: "Move {name} window. Drag or use arrow keys." }),
  panelClose: msg({ id: "chrome.panel.close", message: "Close {label} panel" })
};

/** A `display: contents` host: a React root renders inside while the parent keeps its layout and order. */
export const createReactHost = () => {
  const host = document.createElement("div");
  host.className = WINDOW_HOST_CLASS;
  return host;
};

/** Accessible names of a window's drag handle and close button, from its lower-case name. */
export const getWindowFrameLabels = (name: string, i18n?: I18n) => ({
  close: translateMessage(i18n, WINDOW_CHROME_MESSAGES.close, { name }),
  move: translateMessage(i18n, WINDOW_CHROME_MESSAGES.move, { name })
});

/**
 * The element whose `.settlement-ui__bar` bounds dragging: the frame's parent as laid out, i.e. the host's
 * parent when the frame renders inside a `display: contents` host.
 */
export const getDragScope = (panel: HTMLElement) => {
  const parent = panel.parentElement;
  if (parent?.classList.contains(WINDOW_HOST_CLASS)) return parent.parentElement;
  return parent;
};

/** Accessible name of a corner panel's close button. */
export const getPanelCloseLabel = (label: string, i18n?: I18n) =>
  translateMessage(i18n, WINDOW_CHROME_MESSAGES.panelClose, { label: label.toLowerCase() });
