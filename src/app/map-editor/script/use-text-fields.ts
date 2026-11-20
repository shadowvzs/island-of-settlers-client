import { useLingui } from "@lingui/react";

import type { QuestText } from "../../../../../island-of-settlers-shared/src/script/types/quest-text";
import { textLanguageRows, withTextLanguage } from "./text-fields";

/** The rows of a form text; a blur commits only a changed language. */
export const useQuestTextFields = (text: QuestText, label: string, onCommit: (text: QuestText) => void) => {
  const { i18n } = useLingui();
  return {
    /** Each input is named by its field and language ("Title (Magyar)"). */
    rows: textLanguageRows(text, i18n).map(row => ({ ...row, label: `${label} (${row.languageName})` })),
    onBlur: (language: string, value: string) => {
      const current = typeof text[language] === "string" ? text[language] : "";
      if (value !== current) onCommit(withTextLanguage(text, language, value));
    }
  };
};
