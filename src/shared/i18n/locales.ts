export const SOURCE_LOCALE = "en";
/** Browser-storage key of the chosen interface language (listed in app/preferences/keys.ts). */
export const LANGUAGE_PREFERENCE_KEY = "island-of-settlers.language";
export const LANGUAGE_OPTIONS = [
  { flag: "gb", label: "English", locale: "en" },
  { flag: "hu", label: "Magyar", locale: "hu" },
  { flag: "de", label: "Deutsch", locale: "de" }
] as const;
export type AppLocale = typeof LANGUAGE_OPTIONS[number]["locale"];
export const isAppLocale = (value: unknown): value is AppLocale =>
  LANGUAGE_OPTIONS.some(option => option.locale === value);
