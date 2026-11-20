import type { I18n, MessageDescriptor } from "@lingui/core";

import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { createMusicPlayerWindow } from "../audio/music-player-window";
import { SETTINGS_CHROME_MESSAGES as M } from "./chrome-messages";
import { createCreditsWindow } from "./credits-window";
import { createCustomizationWindow } from "./customization/customization-window";
import { createDeveloperDiary } from "./developer-diary-window";
import { createLanguageWindow } from "./language/language-window";

/** A window shortcut button: the caption (also its accessible name), icon and the window it opens. */
export interface WindowShortcut {
  close?: () => void;
  dispose?: () => void;
  /** A descriptor resolves in the active locale at render time; plain text stays as given. */
  caption: string | MessageDescriptor;
  icon: string;
  /** Stable id of a window a map script may open (TRG9: `language`). */
  id?: "language";
  open: () => void;
  /** The button's ref: the window gives focus back to it on close. */
  registerOpener: (element: HTMLElement | null) => void;
}

export interface ShortcutWindow {
  close?: () => void;
  dispose: () => void;
  open: () => void;
  registerOpener: (element: HTMLElement | null) => void;
}

/** The shortcut of a lazily loaded window (Customization, Music player, Credits, Game News, Language). */
const createWindowShortcut = (
  caption: string | MessageDescriptor, icon: string, target: ShortcutWindow, id?: WindowShortcut["id"]
): WindowShortcut => ({
  caption, close: target.close, dispose: target.dispose, icon, id, open: target.open,
  registerOpener: target.registerOpener
});

/**
 * Main selection shortcuts: Customization, Music player, Credits, Game News and Language. Their lazy
 * windows join the layer at once; React content loads on the first opening.
 */
export const createMainSelectionShortcuts = (
  container: HTMLElement,
  nation: WorkerNation,
  i18n?: I18n,
  setWorkerNation?: (nation: WorkerNation) => Promise<void>
): WindowShortcut[] => {
  const shortcuts: WindowShortcut[] = [
    createWindowShortcut(M.window.musicPlayer, "musicPlayer", createMusicPlayerWindow(container, nation, i18n)),
    createWindowShortcut(M.window.credits, "scroll", createCreditsWindow(container, i18n)),
    createWindowShortcut(M.window.gameNews, "credits", createDeveloperDiary(container, i18n)),
    createWindowShortcut(M.window.language, "map", createLanguageWindow(container, i18n), "language")
  ];
  if (setWorkerNation) {
    const customization = createCustomizationWindow(container, setWorkerNation, i18n);
    shortcuts.unshift(createWindowShortcut(M.window.customization, "customization", customization));
  }
  return shortcuts;
};
