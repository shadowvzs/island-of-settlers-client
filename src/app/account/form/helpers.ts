/** Pure helpers of the account forms (start scroll and Settings > Account). */

import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import {
  DISPLAY_NAME_MAX, DISPLAY_NAME_MIN, EMAIL_MAX, PASSWORD_MAX, PASSWORD_MIN
} from "../account-validation";
import { ACCOUNT_MESSAGES } from "../messages";

/** Field errors of a form by field name (an empty or missing message shows nothing). */
export type FieldErrors<Name extends string> = Partial<Record<Name, string>>;

/** A form-wide message: an error (danger colour) or a notice (ink colour, e.g. "Account imported."). */
export interface FormStatus {
  message: string;
  tone: "error" | "notice";
}

export const NO_STATUS: FormStatus = { message: "", tone: "error" };

export const toErrorStatus = (message: string): FormStatus => ({ message, tone: "error" });

export const toNoticeStatus = (message: string): FormStatus => ({ message, tone: "notice" });

/** `account-status {className}`, plus `is-notice` for a notice. */
export const getStatusClassName = (className: string, { tone }: FormStatus) => {
  const base = `account-status ${className}`;
  if (tone === "notice") return `${base} is-notice`;
  return base;
};

/** Ids of a field's hint and error lines (`{prefix}-{name}-hint|error`) and the input's description. */
export const getFieldIds = (idPrefix: string, name: string, hasHint: boolean) => {
  const errorId = `${idPrefix}-${name}-error`;
  if (!hasHint) return { describedBy: errorId, errorId, hintId: undefined };
  const hintId = `${idPrefix}-${name}-hint`;
  return { describedBy: `${hintId} ${errorId}`, errorId, hintId };
};

/** The first field (in focus order) showing an error; null when none does. */
export const getFirstInvalid = <Name extends string>(order: readonly Name[], errors: FieldErrors<Name>) =>
  order.find(name => Boolean(errors[name])) ?? null;

/** A copy of the errors without one field's message (typing in a field clears its error). */
export const withoutError = <Name extends string>(errors: FieldErrors<Name>, name: Name): FieldErrors<Name> => {
  if (!errors[name]) return errors;
  const next = { ...errors };
  delete next[name];
  return next;
};

/** The working label of a busy button; null while it is idle. */
export const toBusyLabel = (busy: boolean, busyLabel: string) => (busy ? busyLabel : null);

/** Focus order of the sign-in form. */
export const CREDENTIAL_FIELD_ORDER = ["email", "password"] as const;
/** Focus order of the registration form (the nation helmets come last). */
export const REGISTRATION_FIELD_ORDER = ["displayName", "email", "password"] as const;

export const getDisplayNameHint = (i18n?: I18n) =>
  translateMessage(i18n, ACCOUNT_MESSAGES.form.displayNameHint, {
    max: DISPLAY_NAME_MAX,
    min: DISPLAY_NAME_MIN
  });

export const getPasswordHint = (i18n?: I18n) =>
  translateMessage(i18n, ACCOUNT_MESSAGES.form.passwordHint, { min: PASSWORD_MIN });

/** Input settings of a display name field, spread into `AccountField`. */
export const DISPLAY_NAME_INPUT = { maxLength: DISPLAY_NAME_MAX, type: "text" } as const;

/** Input settings of an email field, spread into `AccountField`. */
export const EMAIL_INPUT = { maxLength: EMAIL_MAX, type: "email" } as const;

/** Input settings of a password field, spread into `AccountField`. */
export const PASSWORD_INPUT = { maxLength: PASSWORD_MAX, type: "password" } as const;
