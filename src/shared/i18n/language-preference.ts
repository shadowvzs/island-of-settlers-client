import { type Messages, setupI18n } from "@lingui/core";

import { getLoadedCatalog, loadCatalog } from "./language-catalogs";
import { type AppLocale, isAppLocale, LANGUAGE_PREFERENCE_KEY, SOURCE_LOCALE } from "./locales";

export { LANGUAGE_PREFERENCE_KEY };
export interface LanguagePreferenceState { locale: AppLocale; saved: boolean }
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * Independent of React, accounts, island saves and simulation/replay state. The saved choice is
 * the state at once; its catalog activates when loaded (`ready`), English meanwhile.
 */
export const createLanguagePreference = (storage?: PreferenceStorage) => {
  const read = (): LanguagePreferenceState => {
    try {
      const stored = storage?.getItem(LANGUAGE_PREFERENCE_KEY);
      return { locale: isAppLocale(stored) ? stored : SOURCE_LOCALE, saved: true };
    } catch { return { locale: SOURCE_LOCALE, saved: false }; }
  };
  let state = read();
  const initialLocale = getLoadedCatalog(state.locale) ? state.locale : SOURCE_LOCALE;
  const i18n = setupI18n({ locale: initialLocale, messages: { [initialLocale]: getLoadedCatalog(initialLocale)! } });
  const listeners = new Set<() => void>();
  const apply = (locale: AppLocale, messages: Messages) => {
    if (state.locale === locale && i18n.locale !== locale) i18n.loadAndActivate({ locale, messages });
  };
  /** Activates a loaded catalog at once, else when it arrives; a newer choice wins a race. */
  const activate = (locale: AppLocale): Promise<void> => {
    const loaded = getLoadedCatalog(locale);
    if (loaded) {
      apply(locale, loaded);
      return Promise.resolve();
    }
    return loadCatalog(locale).then(messages => apply(locale, messages), (error: unknown) => {
      console.warn(`Language catalog '${locale}' could not load; English stays active`, error);
    });
  };
  let activation = activate(state.locale);
  const publish = (next: LanguagePreferenceState) => {
    if (state.locale === next.locale && state.saved === next.saved) return;
    state = next;
    activation = activate(next.locale);
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => state,
    i18n,
    /** Resolves once the chosen locale's catalog is active (or failed to load). */
    ready: () => activation,
    reload: () => publish(read()),
    setLanguage: (locale: unknown) => {
      if (!isAppLocale(locale)) return false;
      let saved = false;
      try { if (storage) { storage.setItem(LANGUAGE_PREFERENCE_KEY, locale); saved = true; } } catch { /* Tab choice remains usable. */ }
      publish({ locale, saved });
      return true;
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    }
  };
};
