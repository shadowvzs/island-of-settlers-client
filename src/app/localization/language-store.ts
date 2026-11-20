import { createLanguagePreference, LANGUAGE_PREFERENCE_KEY } from "../../shared/i18n/language-preference";

const browserStorage = () => {
  try { return window.localStorage; } catch { return undefined; }
};
export const languagePreference = createLanguagePreference(browserStorage());
// Node test runs import this module through UI components without a browser window.
if (typeof window !== "undefined") {
  window.addEventListener("storage", event => {
    if (event.key === LANGUAGE_PREFERENCE_KEY || event.key === null) languagePreference.reload();
  });
}
// Only frozen surfaces are translated so far. Keep <html lang="en"> until the public Hungarian
// journey is reviewed end to end; marking a mixed-language document as Hungarian would mislead
// screen readers about the untranslated parts.
