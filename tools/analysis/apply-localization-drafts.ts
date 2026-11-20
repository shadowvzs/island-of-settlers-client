import { existsSync,readdirSync,readFileSync,writeFileSync } from "node:fs";
import { join,resolve } from "node:path";

/**
 * Applies agent-authored localization drafts to the Hungarian PO catalog.
 *
 * Drafts live in docs/localization-drafts/*.json as
 * [{ "id": "feature.key", "message": "English source", "hu": "Hungarian" }].
 * Run `npm run i18n:extract` first; this script deliberately refuses IDs that extraction did not
 * produce, so a typo cannot silently create an unreachable catalog entry.
 */
interface DraftEntry { id: string; message: string; hu: string }
const escape = (value: string) =>
  value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")
    .replaceAll("\n", "\\n").replaceAll("\r", "\\r");
const clientRoot = resolve(import.meta.dirname, "../..");
const repoRoot = resolve(clientRoot, "..");
const drafts = join(repoRoot, "docs/localization-drafts");
const catalog = join(clientRoot, "src/locales/hu/messages.po");
if (!existsSync(catalog)) throw new Error(`Missing catalog: ${catalog}`);
if (!existsSync(drafts)) {
  console.log("No docs/localization-drafts directory; nothing to apply.");
  process.exit(0);
}
const entries = new Map<string, DraftEntry>();
for (const file of readdirSync(drafts).filter(name => name.endsWith(".json")).sort()) {
  const parsed: unknown = JSON.parse(readFileSync(join(drafts, file), "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${file}: expected an array`);
  for (const value of parsed) {
    if (!value || typeof value !== "object") throw new Error(`${file}: invalid entry`);
    const entry = value as Partial<DraftEntry>;
    if (typeof entry.id !== "string" || typeof entry.message !== "string" ||
      typeof entry.hu !== "string" || !entry.id || !entry.message || !entry.hu) {
      throw new Error(`${file}: each entry needs non-empty id/message/hu`);
    }
    const previous = entries.get(entry.id);
    if (previous && (previous.message !== entry.message || previous.hu !== entry.hu)) {
      throw new Error(`${file}: conflicting duplicate ${entry.id}`);
    }
    entries.set(entry.id, { id: entry.id, message: entry.message, hu: entry.hu });
  }
}
let po = readFileSync(catalog, "utf8");
const missing: string[] = [], mismatched: string[] = [], alreadyTranslated: string[] = [];
for (const entry of entries.values()) {
  const block = new RegExp(`msgid "${escape(entry.id)}"\\nmsgstr "([^"]*)"`);
  const match = po.match(block);
  if (!match) { missing.push(entry.id); continue; }
  if (match[1]) {
    if (match[1] === entry.hu) alreadyTranslated.push(entry.id);
    else mismatched.push(entry.id);
    continue;
  }
  po = po.replace(block, `msgid "${escape(entry.id)}"\nmsgstr "${escape(entry.hu)}"`);
}
if (mismatched.length > 0) {
  throw new Error(`Already translated with different text: ${mismatched.join(", ")}`);
}
if (missing.length > 0) {
  throw new Error(`Draft IDs not found after i18n:extract: ${missing.join(", ")}`);
}
writeFileSync(catalog, po);
console.log(JSON.stringify({
  applied: entries.size - alreadyTranslated.length,
  alreadyTranslated: alreadyTranslated.length,
  drafts: readdirSync(drafts).filter(name => name.endsWith(".json")).length
}));

