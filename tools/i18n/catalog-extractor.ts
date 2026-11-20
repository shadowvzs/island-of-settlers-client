import type { ExtractorType } from "@lingui/conf";

/** Core and sidecar data files of the shared content catalog. */
const CATALOG_DATA = /island-of-settlers-shared\/src\/catalog\/data\/.+\.json$/;

interface CatalogText {
  en: string;
  key: string;
}

const isCatalogText = (value: unknown): value is CatalogText => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  return Object.keys(fields).length === 2 && typeof fields.key === "string" && typeof fields.en === "string";
};

/** Every `{ key, en }` text of a JSON value, depth first in file order. */
const collectTexts = (value: unknown, found: CatalogText[] = []): CatalogText[] => {
  if (isCatalogText(value)) {
    found.push(value);
    return found;
  }
  if (typeof value !== "object" || value === null) return found;
  for (const child of Object.values(value)) collectTexts(child, found);
  return found;
};

const lineOf = (code: string, key: string) => {
  const index = code.indexOf(JSON.stringify(key));
  return index < 0 ? 1 : code.slice(0, index).split("\n").length;
};

/**
 * Lingui extractor for the content catalog JSON (plan §6.2): each text's explicit `key` is the message id and
 * `en` its English source, so no `msg()` mirror module is needed and existing ids keep their translations.
 */
export const catalogExtractor: ExtractorType = {
  extract: (filename, code, onMessageExtracted) => {
    for (const text of collectTexts(JSON.parse(code)))
      onMessageExtracted({
        comment: "js-lingui-explicit-id", id: text.key, message: text.en, origin: [filename, lineOf(code, text.key)]
      });
  },
  match: filename => CATALOG_DATA.test(filename.replaceAll("\\", "/"))
};
