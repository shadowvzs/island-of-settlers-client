import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderCreditsMarkdown } from "./credits-markdown";

/**
 * Writes CREDITS.md from src/app/settings/credits-data.ts (`npm run credits`);
 * `--check` only fails when the file is out of date.
 */
const output = resolve(import.meta.dirname, "../../CREDITS.md");
const markdown = renderCreditsMarkdown();

if (process.argv.includes("--check")) {
  if (readFileSync(output, "utf8") !== markdown) throw new Error("CREDITS.md is stale: run npm run credits");
  console.log("CREDITS.md is up to date");
} else {
  writeFileSync(output, markdown);
  console.log(`Wrote ${output}`);
}
