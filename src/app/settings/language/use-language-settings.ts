import { useLingui } from "@lingui/react";
import { useState, useSyncExternalStore } from "react";

import { isAppLocale } from "../../../shared/i18n/locales";
import { languagePreference } from "../../localization/language-store";
import { getLanguageStatus } from "./helpers";

export const useLanguageSettings = () => {
  const { i18n } = useLingui();
  const state = useSyncExternalStore(languagePreference.subscribe, languagePreference.getSnapshot);
  const [pending, setPending] = useState(state.locale);
  const [savedLocale, setSavedLocale] = useState(state.locale);
  // The draft follows a newly saved locale (React's "adjust state when a value changes" pattern).
  if (savedLocale !== state.locale) {
    setSavedLocale(state.locale);
    setPending(state.locale);
  }
  return {
    canApply: pending !== state.locale || !state.saved,
    pending,
    status: getLanguageStatus(state, i18n),
    onApply: () => { languagePreference.setLanguage(pending); },
    onSelect: (value: string) => { if (isAppLocale(value)) setPending(value); }
  };
};
