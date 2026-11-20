import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { ACCOUNT_MESSAGES } from "../messages";

export const SCROLL_TITLE = ACCOUNT_MESSAGES.scroll.title;
export const REGISTER_LEAD = ACCOUNT_MESSAGES.scroll.registerLead;
export const SIGN_IN_LEAD = ACCOUNT_MESSAGES.scroll.signInLead;
export const REGISTRATION_FAILED = ACCOUNT_MESSAGES.scroll.serviceUnavailable;
export const SIGN_IN_FAILED = ACCOUNT_MESSAGES.scroll.serviceUnavailable;
export const CHOOSE_PEOPLE = ACCOUNT_MESSAGES.scroll.choosePeople;
export const RACE_ERROR_ID = "account-race-error";
export const GUEST_HINT = ACCOUNT_MESSAGES.scroll.guestHint;
export const LOCAL_ACCOUNTS_TITLE = ACCOUNT_MESSAGES.scroll.localAccountsTitle;
export const LOCAL_ACCOUNTS_NOTE = ACCOUNT_MESSAGES.scroll.localAccountsNote;
export const EXPORT_FAILED = ACCOUNT_MESSAGES.scroll.exportFailed;
export const CHOICE_FAILED = ACCOUNT_MESSAGES.scroll.choiceFailed;

export const getLocalAccountsLead = (usernames: readonly string[], removeOn: string, i18n?: I18n) =>
  translateMessage(i18n, usernames.length === 1
    ? ACCOUNT_MESSAGES.scroll.localAccountsOne
    : ACCOUNT_MESSAGES.scroll.localAccountsMany, {
    names: usernames.join(", "),
    removeOn
  });

/** Only the first answer takes the focus ref. */
export const firstChoiceRef = <T>(index: number, ref: T) => (index === 0 ? ref : undefined);
