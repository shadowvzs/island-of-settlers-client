import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

/**
 * Applies an explicit translation map to the Lingui catalogs, so repeated translation passes use one
 * reviewed input file instead of ad-hoc catalog edits.
 *
 * Input: a JSON array of `{ id, en?, hu?, de? }`. Every supplied locale is written. Missing ids are a
 * hard error unless `--add-missing` is passed (then a simple explicit-id block is appended); empty
 * translations are refused. Run `npm run i18n:extract` first, then this script, then
 * `npm run i18n:compile`.
 *
 *   npx tsx tools/i18n/apply-translation-map.ts --input ../docs/localization-drafts/<file>.json
 */
interface TranslationEntry {
  de?: string;
  en?: string;
  hu?: string;
  id: string;
}

const { values } = parseArgs({ options: { "add-missing": { type: "boolean" }, input: { type: "string" } } });
if (!values.input) throw new Error("Usage: apply-translation-map.ts --input <translations.json>");
const clientRoot = resolve(import.meta.dirname, "../..");
const input = JSON.parse(readFileSync(resolve(clientRoot, values.input), "utf8")) as unknown;
if (!Array.isArray(input)) throw new Error("The translation map must be a JSON array");
const entries = input as TranslationEntry[];
const escape = (value: string) =>
  value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replaceAll("\n", "\\n").replaceAll("\r", "\\r");
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const counts: Record<string, number> = {};

for (const entry of entries) {
  if (typeof entry.id !== "string" || !entry.id) throw new Error("Every entry needs a non-empty id");
  for (const locale of ["en", "hu", "de"] as const) {
    const text = entry[locale];
    if (text === undefined) continue;
    if (!text) throw new Error(`${entry.id}: ${locale} translation is empty`);
    const file = resolve(clientRoot, `src/locales/${locale}/messages.po`);
    const source = readFileSync(file, "utf8");
    const pattern = new RegExp(`(msgid "${escapeRegExp(entry.id)}"\\nmsgstr ")[^"]*(")`);
    if (!pattern.test(source)) {
      if (!values["add-missing"])
        throw new Error(`${entry.id}: not found in ${locale}; pass --add-missing to append it`);
      const block = `#. js-lingui-explicit-id\nmsgid "${escape(entry.id)}"\nmsgstr "${escape(text)}"\n\n`;
      writeFileSync(file, `${source.trimEnd()}\n\n${block}`);
    } else {
      writeFileSync(file, source.replace(pattern, `$1${escape(text)}$2`));
    }
    counts[locale] = (counts[locale] ?? 0) + 1;
  }
}

console.log(JSON.stringify({ entries: entries.length, written: counts }));
