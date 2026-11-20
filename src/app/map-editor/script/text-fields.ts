import type { I18n } from "@lingui/core";

import type { QuestText } from "../../../../../island-of-settlers-shared/src/script/types/quest-text";
import { LANGUAGE_OPTIONS } from "../../../shared/i18n/locales";
import { translateMessage } from "../../../shared/i18n/translate";
import { focusOnMount } from "./focus";
import { SCRIPT_MESSAGES as M } from "./messages";

/**
 * Player-visible script texts (design §12) in the game's languages (English required, Hungarian and German): one
 * input per language side by side, tagged EN / HU / DE, shared by the slot picker and the variable, board and quest
 * forms.
 */

export interface TextLanguageRow {
  /** "HU": the short tag shown inside the input. */
  code: string;
  /** "Text (Magyar)": the input's full name. */
  label: string;
  /** "Magyar": the tooltip of the language tag. */
  languageName: string;
  language: string;
  value: string;
}

/** One row per game language, English first. */
export const textLanguageRows = (text: QuestText, i18n: I18n | undefined): TextLanguageRow[] =>
  LANGUAGE_OPTIONS.map(option => ({
    code: option.locale.toUpperCase(),
    label: translateMessage(i18n, M.picker.textLanguage, { language: option.label }),
    language: option.locale,
    languageName: option.label,
    value: typeof text[option.locale] === "string" ? text[option.locale] as string : ""
  }));

/** The text with one language changed; an emptied translation is dropped (English always stays). */
export const withTextLanguage = (text: QuestText, language: string, value: string): QuestText => {
  if (language === "en" || value.trim()) return { ...text, [language]: value } as QuestText;
  const { [language]: _dropped, ...rest } = text;
  return rest as QuestText;
};

/** A new text: English empty, no translations. */
export const EMPTY_TEXT: QuestText = { en: "" };

/** The picker focuses its first language input when it opens. */
export const focusRef = (focusFirst: boolean, index: number) => (focusFirst && index === 0 ? focusOnMount
  : undefined);
