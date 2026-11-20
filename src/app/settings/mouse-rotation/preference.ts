import {
  DEFAULT_MOUSE_ROTATION,
  isMouseRotation,
  type MouseRotation
} from "../../../render-common/camera-drag-mapping";
import { createExternalStore } from "../../components/ui-store";
import { rawTextCodec } from "../../preferences/codecs";
import { PREFERENCES } from "../../preferences/keys";
import { definePreference } from "../../preferences/registry";

const storedMouseRotation = definePreference(PREFERENCES.mouseRotation, rawTextCodec);

/**
 * A stored choice, else Middle drag. Players from before the setting (right drag turned the view) have
 * nothing stored and move to the owner's default, so a right tap is free for soldier orders.
 */
export const parseMouseRotation = (stored: string | null): MouseRotation =>
  isMouseRotation(stored) ? stored : DEFAULT_MOUSE_ROTATION;

/** Settings "Mouse rotation"; a per-browser preference like the hotkeys, outside the simulation. */
export const createMouseRotationPreference = (
  stored: string | null, persist: (value: MouseRotation) => void
) => {
  const store = createExternalStore(parseMouseRotation(stored));
  return {
    getSnapshot: store.getSnapshot,
    setRotation: (rotation: MouseRotation) => {
      if (rotation === store.getSnapshot()) return;
      persist(rotation);
      store.set(rotation);
    },
    subscribe: store.subscribe
  };
};

export const mouseRotationPreference = createMouseRotationPreference(
  storedMouseRotation.read(),
  rotation => { storedMouseRotation.write(rotation); }
);
