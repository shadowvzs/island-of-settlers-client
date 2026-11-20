import { useLingui } from "@lingui/react";

import { AccountField } from "../form/account-field";
import { AccountStatus } from "../form/account-status";
import { EMAIL_INPUT, PASSWORD_INPUT } from "../form/helpers";
import { ACCOUNT_MESSAGES } from "../messages";
import { SCROLL_TITLE, SIGN_IN_LEAD } from "./helpers";
import type { AccountFormOptions } from "./scroll-pages";
import { ScrollButton, ScrollHeading, ScrollLinks } from "./scroll-parts";
import { useSignInForm } from "./use-sign-in-form";

/** Sign-in mode of the scroll: email, password and Sign in. */
export const SignInForm = (options: AccountFormOptions) => {
  const { i18n } = useLingui();
  const { busy, fieldProps, status, onSubmit } = useSignInForm(options);
  return (
    <form className="account-scroll__sheet" noValidate onSubmit={onSubmit}>
      <ScrollHeading lead={SIGN_IN_LEAD} title={SCROLL_TITLE} />
      <AccountField
        {...fieldProps("email")}
        {...EMAIL_INPUT}
        autocomplete="email"
        label={i18n._(ACCOUNT_MESSAGES.scroll.email)}
      />
      <AccountField
        {...fieldProps("password")}
        {...PASSWORD_INPUT}
        autocomplete="current-password"
        label={i18n._(ACCOUNT_MESSAGES.scroll.password)}
      />
      <AccountStatus className="account-scroll__status" status={status} />
      <ScrollButton disabled={busy} label={ACCOUNT_MESSAGES.scroll.signIn} />
      <ScrollLinks
        action={ACCOUNT_MESSAGES.scroll.register}
        question={ACCOUNT_MESSAGES.scroll.newPlayer}
        onGuest={options.onGuest}
        onSwitchMode={options.onSwitchMode}
      />
    </form>
  );
};
