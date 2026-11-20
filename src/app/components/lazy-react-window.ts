import type { I18n } from "@lingui/core";

import { appendToLayer, isolatePointer } from "../window-layer";
import {
  createLazyReactContent,
  type LazyContentTexts,
  type MountWindowContent
} from "./lazy-react-content";
import { createWindowFrame } from "./window/window-frame-controller";

const closeCallbacks = new Set<() => void>();

/** Closes every window opened through the shared lazy-window frame (used by presentation modes). */
export const closeAllLazyReactWindows = () => {
  for (const close of closeCallbacks) close();
};

/** What a window policy may do with the frame. */
export interface LazyWindowView {
  /** Hides the window (the frame's own close button calls back into the policy's `close`). */
  hide: () => void;
  /** Gives focus back to the control that opened the window. */
  restoreFocus: () => void;
  /** Shows the window, moves focus into it and loads its content on first open. */
  show: () => void;
}

/** Open / close / Escape rules of one window. */
export interface LazyWindowPolicy {
  close: () => void;
  /** Returns true when the key was handled (the window then stops it). */
  handleKey: (key: string) => boolean;
  open: () => void;
}

/**
 * The default: open shows (again when already open, which raises and refocuses it), close hides and
 * refocuses the opener once, Escape closes this window only while it is open.
 */
export const createDefaultPolicy = (view: LazyWindowView): LazyWindowPolicy => {
  let isOpen = false;
  const close = () => {
    if (!isOpen) return;
    isOpen = false;
    view.hide();
    view.restoreFocus();
  };
  const open = () => {
    isOpen = true;
    view.show();
  };
  const handleKey = (key: string) => {
    if (!isOpen || key !== "Escape") return false;
    close();
    return true;
  };
  return { close, handleKey, open };
};

export interface LazyReactWindowOptions {
  className: string;
  container: HTMLElement;
  /** Class of the content element itself (e.g. the scrolling body). */
  contentClassName?: string;
  /** A resolver lets the frame follow a live locale change instead of freezing the startup language. */
  heading: string | (() => string);
  id: string;
  /** Re-resolves the heading and window name when the active locale changes. */
  i18n?: I18n;
  /** Wraps the window in its own element with this class inside the shared window layer. */
  layerClassName?: string;
  load: () => Promise<MountWindowContent>;
  /** Replaces the default open/close/Escape policy. */
  policy?: (view: LazyWindowView) => LazyWindowPolicy;
  /** Scrolls the content back to the top on every open. */
  resetScrollOnOpen?: boolean;
  /** Visible loading/error text of the lazily loaded body. */
  texts?: LazyContentTexts;
}

/**
 * The shared window frame (drag, close, layer) with React content that loads on first open, so React and
 * the feature code stay out of the startup bundle. Escape closes this window only. The opener (a React
 * button, `aria-haspopup="dialog"`) registers itself with `registerOpener` to get focus back on close.
 */
export const createLazyReactWindow = (options: LazyReactWindowOptions) => {
  const {
    className, container, contentClassName, heading, i18n, id, layerClassName, load, resetScrollOnOpen, texts
  } = options;
  const resolveHeading = typeof heading === "string" ? () => heading : heading;
  const initialHeading = resolveHeading();
  const content = document.createElement("div");
  if (contentClassName) content.className = contentClassName;
  const lazyContent = createLazyReactContent(content, initialHeading, load, texts);
  let disposed = false;
  let opener: HTMLElement | null = null;
  const policy = (options.policy ?? createDefaultPolicy)({
    hide: () => frame.hide(),
    restoreFocus: () => opener?.focus(),
    show: () => {
      frame.open();
      lazyContent.mount();
    }
  });
  const resetScroll = () => { content.scrollTop = 0; };
  const frame = createWindowFrame({
    className, content, heading: initialHeading, id, onClose: policy.close,
    onOpened: resetScrollOnOpen ? resetScroll : undefined
  });
  /** DOM-created title and drag/close names follow the active locale without remounting the React body. */
  const stopLocale = i18n?.on("change", () => {
    const next = resolveHeading();
    frame.setTitle(next);
    frame.setName(next.toLowerCase());
  });
  closeCallbacks.add(policy.close);
  frame.root.addEventListener("keydown", event => {
    if (policy.handleKey(event.key)) event.stopPropagation();
  });
  isolatePointer(frame.root);
  const root = appendToLayer(container, frame.root, layerClassName);
  return {
    close: policy.close,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      closeCallbacks.delete(policy.close);
      stopLocale?.();
      lazyContent.dispose();
      frame.dispose();
      opener = null;
      root.remove();
    },
    open: () => { if (!disposed) policy.open(); },
    /** The opener's ref: the element that gets focus back when the window closes. */
    registerOpener: (element: HTMLElement | null) => { opener = element; },
    root: frame.root
  };
};
