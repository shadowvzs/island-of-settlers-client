import type { TerrainRenderer } from "../render-common/renderer-contract";
import { matchesHotkey } from "./settings/hotkeys/bindings";

/** Cinematic camera on C (and from the settings panel). */
export const createViewModeInput = (renderer: TerrainRenderer) => {
  const toggle = () => {
    renderer.setViewMode(renderer.getViewMode() === "iso" ? "cinematic" : "iso");
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!matchesHotkey("cinematic", event)) return;
    event.preventDefault();
    toggle();
  };
  window.addEventListener("keydown", onKeyDown);
  return {
    dispose: () => window.removeEventListener("keydown", onKeyDown),
    toggle
  };
};
