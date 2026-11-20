import type { I18n } from "@lingui/core";

import {
  CAMPAIGN_DEFAULT_LANGUAGES, CAMPAIGN_FALLBACK_LANGUAGE
} from "../../../../../../island-of-settlers-shared/src/campaign/campaign-constants";
import {
  missingTranslations, type TranslatableText
} from "../../../../../../island-of-settlers-shared/src/campaign/campaign-text";
import { type AppLocale, isAppLocale, LANGUAGE_OPTIONS } from "../../../../shared/i18n/locales";
import { translateMessage } from "../../../../shared/i18n/translate";
import { CAMPAIGN_EDITOR_MESSAGES as M } from "../messages";

/** One language input of the TranslationPanel. */
export interface TranslationRow {
  label: string;
  language: string;
  /** The game locale whose flag is shown, or null for a language the game UI does not offer. */
  locale: AppLocale | null;
  missing: boolean;
  value: string;
}

const languageLabel = (language: string) =>
  LANGUAGE_OPTIONS.find(option => option.locale === language)?.label ?? language.toUpperCase();

/** One row per editor language (English first); a missing translation is flagged. */
export const translationRows = (
  text: TranslatableText, languages: readonly string[] = CAMPAIGN_DEFAULT_LANGUAGES
): TranslationRow[] => {
  const missing = new Set(missingTranslations(text, languages));
  return languages.map(language => ({
    label: languageLabel(language),
    language,
    locale: isAppLocale(language) ? language : null,
    missing: missing.has(language),
    value: text[language] ?? ""
  }));
};

/**
 * The view model of a translatable field: the main input shows the default language only (owner UI spec, so the
 * form scales to many languages); the button opens the panel with one input per language.
 */
export const translationFieldView = (text: TranslatableText, label: string, i18n?: I18n) => {
  const rows = translationRows(text);
  const missing = rows.filter(row => row.missing && row.language !== CAMPAIGN_FALLBACK_LANGUAGE);
  return {
    buttonLabel: translateMessage(i18n, M.actions.translate, { field: label }),
    mainValue: text[CAMPAIGN_FALLBACK_LANGUAGE] ?? "",
    missingNote: translateMessage(i18n, M.notes.translationMissing, {
      languages: missing.map(row => row.label).join(", ")
    }),
    missingTranslation: missing.length > 0,
    rows
  };
};

/** Escape in a translation input closes the panel. */
export const closeOnEscape = (key: string, onClose: () => void) => {
  if (key === "Escape") onClose();
};
