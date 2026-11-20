import { matchesHotkey } from "./settings/hotkeys/bindings";

/**
 * Clean-view toggle (default U) for screenshots and recordings, in the normal and the possessed view.
 * A capture listener registered at island start runs before the possessed-mode key blocker. The flag is
 * not persisted, so a reload always brings the interface back.
 */
export const createHudVisibilityInput = (root: HTMLElement = document.documentElement) => {
  const toggle = () => {
    if (root.dataset.hudHidden) delete root.dataset.hudHidden;
    else root.dataset.hudHidden = "true";
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!matchesHotkey("hideHud", event)) return;
    event.preventDefault();
    toggle();
  };
  window.addEventListener("keydown", onKeyDown, true);
  return {
    dispose: () => {
      window.removeEventListener("keydown", onKeyDown, true);
      delete root.dataset.hudHidden;
    },
    toggle
  };
};
