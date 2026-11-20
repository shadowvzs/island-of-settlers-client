import { type I18n, setupI18n } from "@lingui/core";

import { messages as english } from "../../../locales/en/messages";
import { messages as hungarian } from "../../../locales/hu/messages";

let instances: readonly I18n[] | undefined;

/**
 * English and Hungarian catalogs for the picker search, whatever the active language: a name matches in either
 * language (owner 2026-11-11). The catalogs are already bundled by the language preference; only the instances
 * are new, created once.
 */
export const searchLocales = (): readonly I18n[] => {
  instances ??= [
    setupI18n({ locale: "en", messages: { en: english } }),
    setupI18n({ locale: "hu", messages: { hu: { ...english, ...hungarian } } })
  ];
  return instances;
};
