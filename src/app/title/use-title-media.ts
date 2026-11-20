import { useEffect, useState } from "react";

import type { GameSettings } from "../../../../island-of-settlers-shared/src/game-settings/game-settings";
import { findTitleBackground, findTitleMusic, playTitleMusic, type TitleBackground } from "./title-media";

/**
 * The title page's background file and music (owner 2026-11-12): probed once per page; nothing found keeps the
 * loading scene's painted, moving art and silence. The music stops with the page.
 */
export const useTitleMedia = (settings: GameSettings | null, baseUrl: string) => {
  const [background, setBackground] = useState<TitleBackground | null>(null);
  useEffect(() => {
    let current = true;
    let stopMusic: (() => void) | null = null;
    void findTitleBackground(settings, baseUrl).then(found => { if (current) setBackground(found); });
    void findTitleMusic(settings, baseUrl).then(url => { if (current && url) stopMusic = playTitleMusic(url); });
    return () => {
      current = false;
      stopMusic?.();
    };
  }, [baseUrl, settings]);
  return background;
};
