import { createExternalStore } from "../components/ui-store";
import { flagCodec } from "../preferences/codecs";
import { PREFERENCES } from "../preferences/keys";
import { definePreference } from "../preferences/registry";

import "./game-cursors.css";

/** game-cursors.css turns the game cursor tokens off below a root carrying this attribute. */
export const SYSTEM_CURSOR_ATTRIBUTE = "data-system-cursor";

/** Only a fine hovering pointer (a mouse or trackpad) ever shows a cursor; touch screens skip the setting. */
export const hasHoverPointer = () => globalThis.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? false;

/** Marks the page root; absent outside a browser (tests, workers). */
export const applySystemCursor = (enabled: boolean, root = globalThis.document?.documentElement) => {
  root?.toggleAttribute(SYSTEM_CURSOR_ATTRIBUTE, enabled);
};

/** Settings > Misc "System cursor" (off by default: the game's own cursor set). Applies the choice on creation. */
export const createSystemCursorPreference = (
  stored: boolean, persist: (enabled: boolean) => void, apply: (enabled: boolean) => void
) => {
  const store = createExternalStore(stored);
  apply(stored);
  return {
    getSnapshot: store.getSnapshot,
    setEnabled: (enabled: boolean) => {
      if (enabled === store.getSnapshot()) return;
      persist(enabled);
      apply(enabled);
      store.set(enabled);
    },
    subscribe: store.subscribe
  };
};

const storedSystemCursor = definePreference(PREFERENCES.systemCursor, flagCodec(false));

/** Imported by the first startup entry, so the chosen cursor shows from the loading screen on. */
export const systemCursorPreference = createSystemCursorPreference(
  storedSystemCursor.read(),
  enabled => { storedSystemCursor.write(enabled); },
  enabled => { applySystemCursor(enabled); }
);
