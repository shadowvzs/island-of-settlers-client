import type { Messages } from "@lingui/core";

import { messages as english } from "../../locales/en/messages";
import { type AppLocale, SOURCE_LOCALE } from "./locales";

type TranslatedLocale = Exclude<AppLocale, typeof SOURCE_LOCALE>;

/**
 * Translated catalogs are optional, settings-gated modules: only the source catalog ships in the
 * startup bundle and a translation loads when it is first chosen (CODING-RULES §3).
 */
const CATALOG_LOADERS: Record<TranslatedLocale, () => Promise<{ messages: Messages }>> = {
  de: () => import("../../locales/de/messages"),
  hu: () => import("../../locales/hu/messages")
};

const loadedCatalogs = new Map<AppLocale, Messages>([[SOURCE_LOCALE, english]]);
const pendingCatalogs = new Map<AppLocale, Promise<Messages>>();

/** The catalog of a locale when it is already in memory (untranslated ids fall back to English). */
export const getLoadedCatalog = (locale: AppLocale) => loadedCatalogs.get(locale);

/** Loads a locale's catalog once; concurrent requests share the same import. */
export const loadCatalog = (locale: AppLocale): Promise<Messages> => {
  const loaded = loadedCatalogs.get(locale);
  if (loaded) return Promise.resolve(loaded);
  const pending = pendingCatalogs.get(locale);
  if (pending) return pending;
  const request = CATALOG_LOADERS[locale as TranslatedLocale]().then(({ messages }) => {
    const catalog = { ...english, ...messages };
    loadedCatalogs.set(locale, catalog);
    return catalog;
  }).finally(() => { pendingCatalogs.delete(locale); });
  pendingCatalogs.set(locale, request);
  return request;
};
