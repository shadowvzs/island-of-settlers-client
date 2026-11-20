import { useLingui } from "@lingui/react";
import { useId, useState } from "react";

import type { TranslatableText } from "../../../../../../island-of-settlers-shared/src/campaign/campaign-text";
import { withTranslation } from "../helpers";
import { translationFieldView } from "./helpers";

export interface TranslationFieldOptions {
  label: string;
  text: TranslatableText;
  onChange: (text: TranslatableText) => void;
}

/** Open state and edits of one translatable field (the main input writes English, the panel any language). */
export const useTranslationField = ({ label, onChange, text }: TranslationFieldOptions) => {
  const { i18n } = useLingui();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return {
    ...translationFieldView(text, label, i18n),
    open,
    panelId,
    onClose: () => setOpen(false),
    onLanguageChange: (language: string, value: string) => onChange(withTranslation(text, language, value)),
    onMainChange: (value: string) => onChange(withTranslation(text, "en", value)),
    onToggle: () => setOpen(!open)
  };
};
