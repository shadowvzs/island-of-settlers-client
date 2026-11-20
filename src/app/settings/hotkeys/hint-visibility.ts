import { createExternalStore } from "../../components/ui-store";
import { rawTextCodec } from "../../preferences/codecs";
import { PREFERENCES } from "../../preferences/keys";
import { definePreference } from "../../preferences/registry";

const hintPreference = definePreference(PREFERENCES.hotkeyHints, rawTextCodec);
/** Presentation preference only: hiding hints never disables movement, actions or emergency Back. */
export const createHotkeyHintVisibility = (stored: string | null, persist: (value: string) => void) => {
  const store = createExternalStore(stored !== "hidden");
  return { ...store, toggle: () => {
    const visible = !store.getSnapshot(); persist(visible ? "visible" : "hidden"); store.set(visible);
  } };
};
export const hotkeyHintVisibility = createHotkeyHintVisibility(
  hintPreference.read(), value => { hintPreference.write(value); }
);
