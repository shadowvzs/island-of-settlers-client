import type { I18n } from "@lingui/core";

import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { translateMessage } from "../../shared/i18n/translate";
import { createLazyReactWindow } from "../components/lazy-react-window";
import { SETTINGS_CHROME_MESSAGES as M } from "../settings/chrome-messages";
import { MUSIC_MESSAGES } from "./messages";
import { createBrowserMusicPlayer } from "./music-player-service";

import "./music-player.css";

/**
 * Draggable music player opened from the Main selection. React content and the audio service load on
 * first open; closing hides the window only, so music keeps playing and reopening shows its state.
 */
export const createMusicPlayerWindow = (container: HTMLElement, nation: WorkerNation, i18n?: I18n) => {
  // Create the page player at boot; the lazy window reuses it and never restarts its chosen queue.
  createBrowserMusicPlayer(nation, i18n);
  return createLazyReactWindow({
  className: "music-player-window", container, contentClassName: "music-player",
  heading: () => translateMessage(i18n, M.window.musicPlayer), i18n, id: "music-player-title",
  load: async () => {
    const { mountMusicPlayer } = await import("./music-player-panel");
    return content => mountMusicPlayer(content, nation, i18n);
  },
  texts: {
    error: () => translateMessage(i18n, MUSIC_MESSAGES.window.loadFailed),
    loading: () => translateMessage(i18n, MUSIC_MESSAGES.window.loading)
  }
  });
};
