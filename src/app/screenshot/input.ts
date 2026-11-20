import { hotkeyEventAllowed } from "../settings/hotkeys/bindings";
import { SCREENSHOT_HOTKEY } from "./constants";

/**
 * F9 asks the render loop for the next drawn frame; the loop hands its canvas to the capture sink
 * in that frame's task. A capture listener runs before the possessed-mode key blocker, like the
 * clean-view toggle, so the shortcut works in every view.
 */
export const createScreenshotInput = (request: () => void) => {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== SCREENSHOT_HOTKEY || !hotkeyEventAllowed(event)) return;
    event.preventDefault();
    request();
  };
  window.addEventListener("keydown", onKeyDown, true);
  return {
    dispose: () => window.removeEventListener("keydown", onKeyDown, true)
  };
};
