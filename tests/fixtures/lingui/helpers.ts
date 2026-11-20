import type { I18n } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";

export const greeting = msg({ id: "macro.greeting", message: "Welcome, {name}!" });

export const getGreeting = (i18n: I18n, name: string) =>
  t(i18n)({ id: "macro.greeting", message: `Welcome, ${name}!` });
