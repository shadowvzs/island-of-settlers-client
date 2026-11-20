import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import { createLazyReactWindow } from "../components/lazy-react-window";
import { createExternalStore } from "../components/ui-store";
import type { SlotListMode } from "./helpers";
import { SAVE_SLOTS_MESSAGES as M } from "./messages";
import type { SaveSlotsControls } from "./slot-actions";

import "./save-slots.css";

/** Which list the window shows and how often it was opened (every opening reads the slots again). */
export interface SaveSlotsWindowState {
  mode: SlotListMode;
  opening: number;
}

/**
 * The in-game Save/Load window (plan §7.6): the shared movable frame with the slot list loaded on first open, so the
 * list's React code stays out of the startup bundle. Save opens it to save into a slot, Load to load one.
 */
export const createSaveSlotsWindow = (container: HTMLElement, controls: SaveSlotsControls, i18n?: I18n) => {
  const state = createExternalStore<SaveSlotsWindowState>({ mode: "load", opening: 0 });
  const window = createLazyReactWindow({
    className: "save-slots-window", container, contentClassName: "save-slots-window__body", i18n,
    heading: () => translateMessage(i18n, M.heading), id: "save-slots-title",
    load: async () => (await import("./mount-save-slots")).createSaveSlotsMount(controls, state)
  });
  return {
    dispose: window.dispose,
    open: (mode: SlotListMode) => {
      state.set({ mode, opening: state.getSnapshot().opening + 1 });
      window.open();
    }
  };
};

export type SaveSlotsWindow = ReturnType<typeof createSaveSlotsWindow>;
