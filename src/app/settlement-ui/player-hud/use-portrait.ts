import { type RefObject, useEffect, useState, useSyncExternalStore } from "react";

import { settingsStorage } from "../../settings/graphics-settings";
import { getPortraitSize, PORTRAIT_FPS, PORTRAIT_FRAMES, PORTRAIT_SIZE, portraitFrameCell } from "./helpers";

const COMPACT_QUERY = "(max-width: 480px)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const SERVER_PORTRAIT_SIZE = `${PORTRAIT_SIZE}px`;

let compactLayout: MediaQueryList | undefined;
const readPortraitSize = () => {
  compactLayout ??= matchMedia(COMPACT_QUERY);
  return getPortraitSize(compactLayout.matches, devicePixelRatio);
};

/** Resizes cover browser zoom too, which changes the device pixel ratio. */
const subscribeResize = (listener: () => void) => {
  addEventListener("resize", listener);
  return () => removeEventListener("resize", listener);
};

/** The device-pixel-snapped portrait size; re-renders only when a resize changes it. */
export const usePortraitSize = () =>
  useSyncExternalStore(subscribeResize, readPortraitSize, () => SERVER_PORTRAIT_SIZE);

/**
 * Steps the portrait sheet at PORTRAIT_FPS, column by column, then row by row, by writing two CSS
 * properties on the element (no React render per frame). Every offset is a whole multiple of the snapped
 * portrait size, so each frame lands on whole pixels. Paused while the page or the portrait is hidden and
 * with reduced motion.
 */
export const usePortraitAnimation = (portrait: RefObject<HTMLElement | null>, paused: boolean) => {
  useEffect(() => {
    if (paused) return;
    const reducedMotion = matchMedia(REDUCED_MOTION_QUERY);
    let frame = 0;
    const showNextFrame = () => {
      const element = portrait.current;
      if (!element || document.hidden || reducedMotion.matches) return;
      frame = (frame + 1) % PORTRAIT_FRAMES;
      const { column, row } = portraitFrameCell(frame);
      element.style.setProperty("--portrait-column", String(column));
      element.style.setProperty("--portrait-row", String(row));
    };
    const timer = setInterval(showNextFrame, 1000 / PORTRAIT_FPS);
    return () => clearInterval(timer);
  }, [paused, portrait]);
};

/** Desktop starts with its framed portrait restored; compact screens retain their saved choice. */
export const usePortraitHidden = () => {
  const [hidden, setHidden] = useState(() =>
    matchMedia(COMPACT_QUERY).matches && settingsStorage.readPortraitHidden());
  return {
    portraitHidden: hidden,
    onTogglePortrait: () => {
      settingsStorage.writePortraitHidden(!hidden);
      setHidden(!hidden);
    }
  };
};
