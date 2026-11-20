import { useLingui } from "@lingui/react";

import { type AppLocale, LANGUAGE_OPTIONS } from "../../shared/i18n/locales";
import { languagePreference } from "./language-store";

import "./language-choice.css";

interface LanguageFlagProps {
  locale: AppLocale;
}
/** A small inline flag so the choice never depends on platform emoji fonts. */
export const LanguageFlag = ({ locale }: LanguageFlagProps) => {
  if (locale === "de")
    return (
      <svg aria-hidden="true" className="language-choice__flag" focusable="false" viewBox="0 0 60 36">
        <rect fill="#ffce00" height="36" width="60" />
        <rect fill="#000000" height="12" width="60" />
        <rect fill="#dd0000" height="12" width="60" y="12" />
      </svg>
    );
  if (locale === "hu")
    return (
      <svg aria-hidden="true" className="language-choice__flag" focusable="false" viewBox="0 0 60 36">
        <rect fill="#ffffff" height="36" width="60" />
        <rect fill="#ce2939" height="12" width="60" />
        <rect fill="#477050" height="12" width="60" y="24" />
      </svg>
    );
  return (
    <svg aria-hidden="true" className="language-choice__flag" focusable="false" viewBox="0 0 60 36">
      <rect fill="#012169" height="36" width="60" />
      <path d="M0 0 60 36M60 0 0 36" stroke="#ffffff" strokeWidth="8" />
      <path d="M0 0 60 36M60 0 0 36" stroke="#c8102e" strokeWidth="4" />
      <path d="M30 0v36M0 18h60" stroke="#ffffff" strokeWidth="14" />
      <path d="M30 0v36M0 18h60" stroke="#c8102e" strokeWidth="8" />
    </svg>
  );
};

interface LanguageChoiceProps {
  className?: string;
  label: string;
  selected: string;
  onSelect: (locale: string) => void;
}
const languageChoiceClassName = (className?: string) => {
  if (className) return `language-choice ${className}`;
  return "language-choice";
};
/** Flag + autonym buttons: the same choice on the first-run scroll and in Settings > Language. */
export const LanguageChoice = ({ className, label, selected, onSelect }: LanguageChoiceProps) => (
  <div
    aria-label={label}
    className={languageChoiceClassName(className)}
    role="radiogroup"
  >
    {LANGUAGE_OPTIONS.map(option => (
      <button
        aria-checked={selected === option.locale}
        className="language-choice__option"
        key={option.locale}
        role="radio"
        title={option.label}
        type="button"
        onClick={() => onSelect(option.locale)}
      >
        <LanguageFlag locale={option.locale} />
        <span>{option.label}</span>
      </button>
    ))}
  </div>
);

interface LiveLanguageChoiceProps {
  className?: string;
  label: string;
}
/** The choice wired to the live preference, for screens outside the Settings window. */
export const LiveLanguageChoice = ({ className, label }: LiveLanguageChoiceProps) => {
  const { i18n } = useLingui();
  return (
    <LanguageChoice
      className={className}
      label={label}
      selected={i18n.locale}
      onSelect={locale => { languagePreference.setLanguage(locale); }}
    />
  );
};
