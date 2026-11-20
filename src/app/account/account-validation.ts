/** Registration rules of the identity service (docs/server/identity.md), checked in the form first. */

import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import { ACCOUNT_MESSAGES } from "./messages";

export const DISPLAY_NAME_MIN = 3;
export const DISPLAY_NAME_MAX = 32;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;
export const EMAIL_MAX = 254;

const LETTERS_AND_DIGITS = /^[A-Za-z0-9]+$/;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An error message for the player, or null when the value is valid. */
export type ValidationResult = string | null;

export const validateDisplayName = (name: string, i18n?: I18n): ValidationResult => {
  if (!name) return translateMessage(i18n, ACCOUNT_MESSAGES.validation.displayNameRequired);
  if (!LETTERS_AND_DIGITS.test(name))
    return translateMessage(i18n, ACCOUNT_MESSAGES.validation.displayNameCharset);
  if (name.length < DISPLAY_NAME_MIN || name.length > DISPLAY_NAME_MAX)
    return translateMessage(i18n, ACCOUNT_MESSAGES.validation.displayNameLength, {
      max: DISPLAY_NAME_MAX, min: DISPLAY_NAME_MIN
    });
  return null;
};

export const validateEmail = (email: string, i18n?: I18n): ValidationResult => {
  if (!email) return translateMessage(i18n, ACCOUNT_MESSAGES.validation.emailRequired);
  if (email.length > EMAIL_MAX || !EMAIL_SHAPE.test(email))
    return translateMessage(i18n, ACCOUNT_MESSAGES.validation.emailInvalid);
  return null;
};

export const validatePassword = (password: string, i18n?: I18n): ValidationResult => {
  if (!password) return translateMessage(i18n, ACCOUNT_MESSAGES.validation.passwordRequired);
  if (password.length > PASSWORD_MAX || password.trim().length < PASSWORD_MIN)
    return translateMessage(i18n, ACCOUNT_MESSAGES.validation.passwordLength, {
      max: PASSWORD_MAX, min: PASSWORD_MIN
    });
  return null;
};
