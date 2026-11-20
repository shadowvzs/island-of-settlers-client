import { useLingui } from "@lingui/react";

import type { AppLocale } from "../../../shared/i18n/locales";
import { IconButton } from "../../components/icon-button";
import { InlineInfo } from "../../components/info-hint";
import { mountReactIsland } from "../../components/react-island";
import { LanguageChoice } from "../../localization/language-choice";
import { LANGUAGE_MESSAGES } from "./messages";
import { useLanguageSettings } from "./use-language-settings";

interface LanguagePanelProps {
  canApply: boolean;
  pending: AppLocale;
  status: string;
  onApply: () => void;
  onSelect: (locale: string) => void;
}
const LanguagePanelView = ({ canApply, pending, status, onApply, onSelect }: LanguagePanelProps) => {
  const { i18n } = useLingui();
  const label = i18n._(LANGUAGE_MESSAGES.label);
  return (
    <div className="language-settings">
      <div className="language-settings__label-row">
        <span className="language-settings__label">{label}</span>
        <InlineInfo info={{ label, text: i18n._(LANGUAGE_MESSAGES.help) }} />
      </div>
      <div className="language-settings__selection">
        <LanguageChoice label={label} selected={pending} onSelect={onSelect} />
        <IconButton
          className="language-settings__apply"
          disabled={!canApply}
          icon="apply"
          label={i18n._(LANGUAGE_MESSAGES.apply)}
          onClick={onApply}
        />
      </div>
      <p role="status">{status}</p>
    </div>
  );
};
/** Settings > Language and the title page's settings: the flag choice with its Apply button. */
export const LanguageSettings = () => <LanguagePanelView {...useLanguageSettings()} />;

/** A small React island; the rest of the game's HUD and simulation keep their existing lifecycle. */
export const mountLanguagePanel = (container: HTMLElement) => mountReactIsland(container, <LanguageSettings />);
