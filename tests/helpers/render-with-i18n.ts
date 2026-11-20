import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { messages as german } from "../../src/locales/de/messages";
import { messages as english } from "../../src/locales/en/messages";
import { messages as hungarian } from "../../src/locales/hu/messages";

export type TestLocale = "de" | "en" | "hu";

export const createTestI18n = (locale: TestLocale = "en") =>
  setupI18n({ locale, messages: { de: german, en: english, hu: hungarian } });

/** Server-render a component with the real compiled catalogs (the app mounts its own provider). */
export const renderWithI18n = (element: ReactElement, locale: TestLocale = "en") =>
  renderToStaticMarkup(createElement(I18nProvider, { i18n: createTestI18n(locale) }, element));
