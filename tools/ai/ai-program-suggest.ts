import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { type BuildProgram, resolveBuildPrograms, validateBuildPrograms } from "@shared/catalog";

import { DRAFT_FOLDER, loadProgramSources } from "./program-sources.ts";
import { suggestionSummary, suggestProgramGoals } from "./program-suggest.ts";

/**
 * npm run ai:suggest: for every production and residence building a build program does not list, derives a draft
 * goal (prerequisites from the recipe and construction wares, default target and weight, nation notes) and writes
 * `data/ai/drafts/<style>-suggestions.json`. Never edits a program: review the draft, move entries by hand, then
 * run npm run ai:check.
 */
const { catalog, files, programs, readSidecar } = loadProgramSources();
const malformed = new Set(validateBuildPrograms(files, readSidecar, programs)
  .filter(issue => issue.kind === "shape" || issue.kind === "overlay").map(issue => issue.style));
mkdirSync(DRAFT_FOLDER, { recursive: true });
// An overlay (`extends`, EAI5a) is suggested against the whole program it resolves to.
for (const [style, raw] of Object.entries(resolveBuildPrograms(programs))) {
  if (malformed.has(style)) {
    console.log(`${style}: skipped, the program file is malformed (npm run ai:check)`);
    process.exitCode = 1;
    continue;
  }
  const draft = suggestProgramGoals(catalog, raw as BuildProgram);
  const file = join(DRAFT_FOLDER, `${style}-suggestions.json`);
  writeFileSync(file, `${JSON.stringify(draft, null, 2)}\n`);
  console.log([...suggestionSummary(draft), `  written: ${relative(process.cwd(), file)}`].join("\n"));
}
