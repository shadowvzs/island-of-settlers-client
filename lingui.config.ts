import { babelExtractor } from "@lingui/cli/api/extractors/babel";

import { LANGUAGE_OPTIONS, SOURCE_LOCALE } from "./src/shared/i18n/locales";
import { catalogExtractor } from "./tools/i18n/catalog-extractor";

/** Macro-ready catalogs; content names come from the shared content catalog JSON (tools/i18n/catalog-extractor.ts). */
export default {
  catalogs: [{
    include: ["<rootDir>/src", "<rootDir>/../island-of-settlers-shared/src/catalog/data"],
    path: "<rootDir>/src/locales/{locale}/messages"
  }],
  compileNamespace: "ts",
  extractors: [babelExtractor, catalogExtractor],
  fallbackLocales: { default: SOURCE_LOCALE },
  locales: LANGUAGE_OPTIONS.map(option => option.locale),
  sourceLocale: SOURCE_LOCALE
};
