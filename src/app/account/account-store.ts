import type { I18n } from "@lingui/core";

import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { translateMessage } from "../../shared/i18n/translate";
import { validateDisplayName, validateEmail, validatePassword } from "./account-validation";
import type { IdentityAccount, IdentityClient, IdentityResult } from "./identity-client";
import { ACCOUNT_MESSAGES } from "./messages";

export interface Registration {
  displayName: string;
  email: string;
  password: string;
  race: WorkerNation | null;
}

export type Credentials = Pick<Registration, "email" | "password">;

/** Field errors of a refused registration or sign-in (the form shows each under its field). */
export interface RegistrationErrors {
  displayName?: string;
  email?: string;
  password?: string;
  race?: string;
}

export type AccountResult = { account: IdentityAccount; ok: true } | { errors: RegistrationErrors; ok: false };

export const WRONG_CREDENTIALS = ACCOUNT_MESSAGES.validation.wrongCredentials.message!;
export const ACCOUNT_TAKEN = ACCOUNT_MESSAGES.validation.accountTaken.message!;
export const TOO_MANY_ATTEMPTS = ACCOUNT_MESSAGES.validation.tooManyAttempts.message!;

const withError = (errors: RegistrationErrors, field: keyof RegistrationErrors, message: string | null) =>
  (message ? { ...errors, [field]: message } : errors);

/** Every field error of a registration at once (the form re-checks with it while typing). */
export const collectRegistrationErrors = (
  { displayName, email, password, race }: Registration,
  i18n?: I18n
) => {
  let errors: RegistrationErrors = withError({}, "displayName", validateDisplayName(displayName, i18n));
  errors = withError(errors, "email", validateEmail(email, i18n));
  errors = withError(errors, "password", validatePassword(password, i18n));
  return withError(errors, "race", race ? null : translateMessage(i18n, ACCOUNT_MESSAGES.validation.choosePeople));
};

const collectSignInErrors = ({ email, password }: Credentials, i18n?: I18n): RegistrationErrors => {
  const errors = withError({}, "email", email
    ? null : translateMessage(i18n, ACCOUNT_MESSAGES.validation.emailRequired));
  return withError(errors, "password", password
    ? null : translateMessage(i18n, ACCOUNT_MESSAGES.validation.signInPasswordRequired));
};

const hasErrors = (errors: RegistrationErrors) => Object.values(errors).some(Boolean);

/** A refusal of the identity service under the field it concerns. */
const toFieldErrors = (
  failure: Extract<IdentityResult, { ok: false }>,
  i18n?: I18n
): RegistrationErrors => {
  if (failure.code === "ACCOUNT_ALREADY_EXISTS")
    return { email: translateMessage(i18n, ACCOUNT_MESSAGES.validation.accountTaken) };
  if (failure.code === "AUTH_INVALID_CREDENTIALS")
    return { password: translateMessage(i18n, ACCOUNT_MESSAGES.validation.wrongCredentials) };
  if (failure.code === "RATE_LIMITED" || failure.status === 429)
    return { email: translateMessage(i18n, ACCOUNT_MESSAGES.validation.tooManyAttempts) };
  if (failure.code === "VALIDATION_FAILED")
    return { email: translateMessage(i18n, ACCOUNT_MESSAGES.validation.serviceRefused) };
  throw new Error(failure.message);
};

const toAccountResult = (result: IdentityResult, i18n?: I18n): AccountResult =>
  (result.ok ? result : { errors: toFieldErrors(result, i18n), ok: false });

/** Register and Sign in of the start scroll, against the identity service (fields checked here first). */
export const createAccountStore = (identity: Pick<IdentityClient, "login" | "register">, defaultI18n?: I18n) => ({
  register: async (registration: Registration, i18n = defaultI18n): Promise<AccountResult> => {
    const trimmed = { ...registration, email: registration.email.trim() };
    const errors = collectRegistrationErrors(trimmed, i18n);
    if (hasErrors(errors) || !trimmed.race) return { errors, ok: false };
    const { displayName, email, password, race } = trimmed;
    return toAccountResult(await identity.register({ displayName, email, nation: race, password }), i18n);
  },
  signIn: async (credentials: Credentials, i18n = defaultI18n): Promise<AccountResult> => {
    const errors = collectSignInErrors(credentials, i18n);
    if (hasErrors(errors)) return { errors, ok: false };
    return toAccountResult(
      await identity.login({ email: credentials.email.trim(), password: credentials.password }), i18n
    );
  }
});

export type AccountStore = ReturnType<typeof createAccountStore>;
