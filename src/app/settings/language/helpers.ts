import type { I18n } from "@lingui/core";

import type { LanguagePreferenceState } from "../../../shared/i18n/language-preference";
import { LANGUAGE_OPTIONS } from "../../../shared/i18n/locales";
import { translateMessage } from "../../../shared/i18n/translate";
import { LANGUAGE_MESSAGES } from "./messages";

/** Status line of the language preference, in the selected interface language. */
export const getLanguageStatus = ({ locale, saved }: LanguagePreferenceState, i18n?: I18n) => {
  if (!saved) return translateMessage(i18n, LANGUAGE_MESSAGES.status.unsaved);
  const option = LANGUAGE_OPTIONS.find(option => option.locale === locale)!;
  return translateMessage(i18n, LANGUAGE_MESSAGES.status.selected, { language: option.label });
};
