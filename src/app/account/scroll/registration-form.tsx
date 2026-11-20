import { useLingui } from "@lingui/react";

import { AccountField } from "../form/account-field";
import { AccountStatus } from "../form/account-status";
import {
  DISPLAY_NAME_INPUT, EMAIL_INPUT, getDisplayNameHint, getPasswordHint, PASSWORD_INPUT
} from "../form/helpers";
import { ACCOUNT_MESSAGES } from "../messages";
import { RacePicker } from "../race-picker/race-picker";
import { CHOOSE_PEOPLE, RACE_ERROR_ID, REGISTER_LEAD, SCROLL_TITLE } from "./helpers";
import type { AccountFormOptions } from "./scroll-pages";
import { ScrollButton, ScrollHeading, ScrollLinks } from "./scroll-parts";
import { useRegistrationForm } from "./use-registration-form";

/** Register mode of the scroll: display name, email, password, nation helmets and Register. */
export const RegistrationForm = (options: AccountFormOptions) => {
  const { i18n } = useLingui();
  const {
    busy, fieldProps, race, raceError, racePicker, status, onRaceSelect, onSubmit
  } = useRegistrationForm(options);
  return (
    <form className="account-scroll__sheet" noValidate onSubmit={onSubmit}>
      <ScrollHeading lead={REGISTER_LEAD} title={SCROLL_TITLE} />
      <AccountField
        {...fieldProps("displayName")}
        {...DISPLAY_NAME_INPUT}
        autocomplete="nickname"
        hint={getDisplayNameHint(i18n)}
        label={i18n._(ACCOUNT_MESSAGES.scroll.displayName)}
      />
      <AccountField
        {...fieldProps("email")}
        {...EMAIL_INPUT}
        autocomplete="email"
        label={i18n._(ACCOUNT_MESSAGES.scroll.email)}
      />
      <AccountField
        {...fieldProps("password")}
        {...PASSWORD_INPUT}
        autocomplete="new-password"
        hint={getPasswordHint(i18n)}
        label={i18n._(ACCOUNT_MESSAGES.scroll.password)}
      />
      <fieldset className="account-races">
        <legend className="account-field__label">{i18n._(CHOOSE_PEOPLE)}</legend>
        <RacePicker
          describedBy={RACE_ERROR_ID}
          groupRef={racePicker}
          label={i18n._(CHOOSE_PEOPLE)}
          selected={race}
          size="large"
          onSelect={onRaceSelect}
        />
        <small className="account-field__error" id={RACE_ERROR_ID}>{raceError}</small>
      </fieldset>
      <AccountStatus className="account-scroll__status" status={status} />
      <ScrollButton disabled={busy} label={ACCOUNT_MESSAGES.scroll.register} />
      <ScrollLinks
        action={ACCOUNT_MESSAGES.scroll.signIn}
        question={ACCOUNT_MESSAGES.scroll.alreadyRegistered}
        onGuest={options.onGuest}
        onSwitchMode={options.onSwitchMode}
      />
    </form>
  );
};
