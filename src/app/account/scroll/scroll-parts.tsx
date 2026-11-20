import type { MessageDescriptor } from "@lingui/core";
import { useLingui } from "@lingui/react";
import type { Ref } from "react";

import { translateLabel } from "../../../shared/i18n/translate";
import { LiveLanguageChoice } from "../../localization/language-choice";
import { SETTINGS_CHROME_MESSAGES } from "../../settings/chrome-messages";
import { ACCOUNT_MESSAGES } from "../messages";
import { GUEST_HINT } from "./helpers";

interface ScrollHeadingProps {
  lead: string | MessageDescriptor;
  title: string | MessageDescriptor;
}
/** Title and lead line of the scroll (the dialog is labelled by the title). */
export const ScrollHeading = ({ lead, title }: ScrollHeadingProps) => {
  const { i18n } = useLingui();
  return (
    <header className="account-scroll__heading">
      <h1 id="account-scroll-title">{translateLabel(i18n, title)}</h1>
      <p>{translateLabel(i18n, lead)}</p>
      <LiveLanguageChoice className="account-scroll__language" label={i18n._(SETTINGS_CHROME_MESSAGES.window.language)} />
    </header>
  );
};

interface ScrollButtonProps {
  buttonRef?: Ref<HTMLButtonElement>;
  disabled?: boolean;
  label: string | MessageDescriptor;
  type?: "button" | "submit";
  onClick?: () => void;
}
/** A full-width button in the shared button skin. */
export const ScrollButton = ({
  buttonRef, disabled = false, label, type = "submit", onClick
}: ScrollButtonProps) => {
  const { i18n } = useLingui();
  return (
    <button className="account-scroll__submit" disabled={disabled} ref={buttonRef} type={type} onClick={onClick}>
      {translateLabel(i18n, label)}
    </button>
  );
};

interface ModeSwitchProps {
  action: string | MessageDescriptor;
  question: string | MessageDescriptor;
  onClick: () => void;
}
/** "Already registered? Sign in": a themed text link under the form. */
const ModeSwitch = ({ action, question, onClick }: ModeSwitchProps) => {
  const { i18n } = useLingui();
  return (
    <p className="account-scroll__switch">
      {translateLabel(i18n, question)}{" "}
      <button className="account-scroll__link" type="button" onClick={onClick}>
        {translateLabel(i18n, action)}
      </button>
    </p>
  );
};

interface ScrollLinksProps {
  action: string | MessageDescriptor;
  question: string | MessageDescriptor;
  onGuest: () => void;
  onSwitchMode: () => void;
}
/** The links under a scroll form: switch Register / Sign in, and Play as guest. */
export const ScrollLinks = ({ action, question, onGuest, onSwitchMode }: ScrollLinksProps) => {
  const { i18n } = useLingui();
  return (
    <>
      <ModeSwitch action={action} question={question} onClick={onSwitchMode} />
      <p className="account-scroll__switch">
        {translateLabel(i18n, ACCOUNT_MESSAGES.scroll.justLooking)}{" "}
        <button className="account-scroll__link" type="button" onClick={onGuest}>
          {translateLabel(i18n, ACCOUNT_MESSAGES.scroll.playAsGuest)}
        </button>
      </p>
      <p className="account-scroll__note">{translateLabel(i18n, GUEST_HINT)}</p>
    </>
  );
};
